-- ============================================================================
-- Individual Training Tracking & Leaderboard
-- Spec: docs/specs/individual-training-tracking.md
-- ----------------------------------------------------------------------------
-- Club-tier feature: players log individual training (date, duration, category,
-- note). A session is GLOBAL to the player — it counts on every current
-- team/club board they belong to; team_id is only the logging/category context.
-- Categories are a per-team managed list (training_categories) with one seeded
-- "General" default plus custom types coaches/managers/directors manage.
--
-- Definer functions bypass RLS for membership/plan lookups and the club-board
-- privilege escalation; they pin search_path and schema-qualify per the
-- "Security-definer hygiene" section of the spec. RPCs and helpers that call
-- the pre-existing (not-yet-pinned) helpers use `set search_path = public` so
-- those callees resolve, while still qualifying their own object references.
-- ============================================================================

-- ── Table: training_categories ──────────────────────────────────────────────
-- Created BEFORE training_sessions because the session's category_id FKs it.

create table public.training_categories (
  id uuid primary key default gen_random_uuid(),

  -- Owning team. Team-scoped so a multi-sport club's teams keep distinct lists;
  -- a director reaches any of their org's teams via org-admin (see RLS).
  team_id uuid not null references public.teams(id) on delete cascade,

  -- Display label as typed. The id is the stable identifier; non-default labels
  -- are freely renamable. The system "General" default label is immutable.
  label text not null check (char_length(btrim(label)) between 1 and 40),

  -- Exactly one seeded "General" per team (partial unique index below). The
  -- default is delete/archive/rename-protected by the guard trigger.
  is_default boolean not null default false,

  -- Picker ordering. "General" is 0; custom/suggested rows get server-assigned
  -- positive positions that append.
  sort_order integer not null check (sort_order >= 0),

  -- Soft-delete: removal flips is_active=false so sessions never orphan.
  is_active boolean not null default true,

  -- Null only for the system-seeded default; custom rows carry the acting user.
  created_by uuid references public.profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Only the system-managed default may lack an acting-user audit value.
  check (is_default or created_by is not null)
);

-- No duplicate labels within a team (case/space-insensitive).
create unique index training_categories_team_label_idx
  on public.training_categories (team_id, lower(btrim(label)));

-- At most one default per team.
create unique index training_categories_one_default_idx
  on public.training_categories (team_id) where is_default;

-- Picker load: a team's active categories in deterministic display order.
create index training_categories_team_active_idx
  on public.training_categories (team_id, sort_order, created_at, id) where is_active;

-- ── Table: training_sessions ────────────────────────────────────────────────

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),

  -- The player the session belongs to. For a parent logging on behalf of a
  -- child this is the CHILD's profile, not the parent's.
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Logging/category context — NOT leaderboard credit. Individual training is
  -- global to the player and counts for every current team/club cohort. Required
  -- on every user write (RLS + trigger), but nullable at the column level with
  -- ON DELETE SET NULL: hard-deleting the context team must NOT erase a player's
  -- global session (it still counts on their other teams). The row survives as a
  -- contextless global record. Users can never write a null (RLS WITH CHECK +
  -- trigger rule 1 forbid it); only the delete cascade produces one.
  team_id uuid references public.teams(id) on delete set null,

  -- The day the training happened, as reported. A `date`, not timestamptz:
  -- bucketing is timezone-naive (see leaderboard RPC).
  session_date date not null,

  duration_minutes integer not null check (duration_minutes between 5 and 300),

  -- FK to the logging-context team's managed category list. Required on every
  -- user write (RLS + trigger rule 6), but nullable with ON DELETE SET NULL:
  -- when the context team is hard-deleted its categories cascade away, so the
  -- session's category becomes null (a contextless global row) rather than
  -- blocking the delete. Management removal is always a soft-archive, never a
  -- hard delete, so an in-use category is never dropped this way.
  category_id uuid references public.training_categories(id) on delete set null,

  notes text check (char_length(notes) <= 500),

  -- Who actually entered the row. The validation trigger overwrites it with the
  -- calling profile on insert and forces it immutable on update (unforgeable).
  -- The service role (auth.uid() null) supplies it explicitly when seeding.
  created_by uuid not null references public.profiles(id) default auth.uid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global aggregation resolves a player cohort first, then reads each player's
-- sessions by (profile_id, date). No (team_id, date) index — team_id never
-- partitions leaderboard credit under the global model.
create index training_sessions_profile_date_idx
  on public.training_sessions (profile_id, session_date desc);

-- ── Column: profiles.training_leaderboard_opt_out ───────────────────────────

alter table public.profiles
  add column training_leaderboard_opt_out boolean not null default false;

-- ── Helper functions ────────────────────────────────────────────────────────

-- Is p_id a roster PLAYER on team t_id? Role-only by design (archived-ness is
-- handled separately so aggregation can still surface an archived team's board).
create or replace function public.is_team_player(t_id uuid, p_id uuid)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = t_id
      and tm.profile_id = p_id
      and tm.role = 'player'
  );
$$;

-- Is the team archived?
create or replace function public.is_team_archived(t_id uuid)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select coalesce((select archived_at is not null from public.teams where id = t_id), false);
$$;

-- Resolve a team's timezone SAFELY: fall back to 'UTC' when teams.timezone is
-- null OR a non-IANA string (which would otherwise raise and fail the write).
create or replace function public.safe_team_tz(t_id uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare tz text;
begin
  select timezone into tz from public.teams where id = t_id;
  if tz is null then return 'UTC'; end if;
  perform pg_catalog.now() at time zone tz;   -- raises if tz is not a valid zone
  return tz;
exception when others then
  return 'UTC';
end;
$$;

-- SQL mirror of hasClubAccess() in src/lib/plan.ts. Keep in lockstep.
create or replace function public.has_club_access(o_id uuid)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = o_id
      and o.plan in ('club_small', 'club_large')
      and o.subscription_status in ('trialing', 'active', 'past_due')
  );
$$;

-- Does the CALLER currently administer a live club team on which p_id is a
-- roster player? Keys session visibility/moderation to the player's CURRENT
-- teams (global minutes affect every one of their boards), not the session's
-- logging-context team. `search_path = public` because it calls the pre-existing
-- is_team_admin (Open Question 7); own references stay schema-qualified.
create or replace function public.is_training_admin_for_profile(p_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = p_id
      and tm.role = 'player'
      and t.archived_at is null
      and public.is_team_admin(tm.team_id)
      and public.has_club_access(t.organization_id)
  );
$$;

-- ── Category seeding: one "General" default per team ────────────────────────

create or replace function public.seed_team_default_category()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.training_categories
    (team_id, label, is_default, sort_order, is_active, created_by)
  values (new.id, 'General', true, 0, true, null);
  return new;
end;
$$;

create trigger seed_team_default_category_trg
  after insert on public.teams
  for each row execute function public.seed_team_default_category();

-- Backfill one "General" default for every pre-existing team. (No existing
-- training_sessions data — the feature is unshipped — so nothing to remap.)
insert into public.training_categories
  (team_id, label, is_default, sort_order, is_active, created_by)
select t.id, 'General', true, 0, true, null
from public.teams t
where not exists (
  select 1 from public.training_categories c
  where c.team_id = t.id and c.is_default
);

-- ── Category audit/invariant guard trigger ──────────────────────────────────
-- Enforces the row contract RLS can't express: immutable ownership/authorship,
-- default protection, and "at least one active default." security definer to
-- resolve the caller's profile on custom inserts.

create or replace function public.training_categories_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.now();
    new.updated_at := pg_catalog.now();
    if new.is_default then
      -- The default has exactly one valid shape (team-seeding / backfill only).
      if new.label <> 'General' or new.sort_order <> 0
         or not new.is_active or new.created_by is not null then
        raise exception 'invalid default category shape' using errcode = 'P0010';
      end if;
    else
      -- Custom insert: stamp created_by from the caller (unforgeable).
      if auth.uid() is not null then
        new.created_by := (select id from public.profiles where auth_user_id = auth.uid());
        if new.created_by is null then
          raise exception 'no calling profile' using errcode = 'P0001';
        end if;
      end if;
      -- Service-role custom insert must supply it (also enforced by the CHECK).
      if new.created_by is null then
        raise exception 'created_by required for custom category' using errcode = 'P0011';
      end if;
    end if;
    return new;

  elsif tg_op = 'UPDATE' then
    -- Audit + ownership immutable; timestamp maintained.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := pg_catalog.now();
    if new.team_id is distinct from old.team_id then
      raise exception 'category team_id is immutable' using errcode = 'P0012';
    end if;
    if new.is_default is distinct from old.is_default then
      raise exception 'is_default is immutable' using errcode = 'P0013';
    end if;
    if old.is_default then
      if new.label is distinct from old.label
         or new.sort_order is distinct from old.sort_order then
        raise exception 'default category label/order is immutable' using errcode = 'P0014';
      end if;
      if not new.is_active then
        raise exception 'default category cannot be archived' using errcode = 'P0015';
      end if;
    end if;
    return new;

  else  -- DELETE
    -- Protect the default from DIRECT deletion, but allow it to disappear when
    -- its team is deleted: an ON DELETE CASCADE from teams fires this trigger
    -- only AFTER the parent team row is gone, so the team no longer exists then.
    if old.is_default and exists (select 1 from public.teams where id = old.team_id) then
      raise exception 'default category cannot be deleted' using errcode = 'P0016';
    end if;
    return old;
  end if;
end;
$$;

create trigger training_categories_guard_trg
  before insert or update or delete on public.training_categories
  for each row execute function public.training_categories_guard();

-- ── Session validation trigger ──────────────────────────────────────────────

create or replace function public.training_sessions_validate()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today       date;
  v_other_total integer;
begin
  if tg_op = 'INSERT' then
    -- Stamp created_by from the caller (unforgeable). Only when authenticated;
    -- the service role supplies it explicitly (NOT NULL enforces presence).
    if auth.uid() is not null then
      new.created_by := (select id from public.profiles where auth_user_id = auth.uid());
      if new.created_by is null then
        raise exception 'no calling profile' using errcode = 'P0001';
      end if;
    end if;
  else
    -- created_by immutable on update; stamp updated_at.
    new.created_by := old.created_by;
    new.updated_at := pg_catalog.now();
    -- A genuine ON DELETE SET NULL cascade (context team hard-deleted) nulls
    -- exactly ONE context column and touches nothing else, firing this trigger
    -- as an UPDATE. Let ONLY that precise shape through — the session becomes a
    -- contextless global row that still counts for the player on their other
    -- teams. Any other null-context update (e.g. a client nulling category_id
    -- while also changing the date/duration, or nulling one context column and
    -- editing the other) does NOT match and falls through to full validation
    -- below, which rejects it. Belt and suspenders: the RLS UPDATE WITH CHECK
    -- also forbids a client from writing a null context at all.
    if new.profile_id          =            old.profile_id
       and new.session_date     =            old.session_date
       and new.duration_minutes =            old.duration_minutes
       and new.notes is not distinct from    old.notes
       and (
         (new.team_id is null and old.team_id is not null
            and new.category_id is not distinct from old.category_id)
         or
         (new.category_id is null and old.category_id is not null
            and new.team_id is not distinct from old.team_id)
       )
    then
      return new;
    end if;
  end if;

  -- 1. must be a roster player on the logging-context team (also gates edits:
  --    a player who left the team can no longer edit an in-window session).
  if not public.is_team_player(new.team_id, new.profile_id) then
    raise exception 'profile is not a player on this team' using errcode = 'P0002';
  end if;

  -- 2. logging-context team must not be archived
  if public.is_team_archived(new.team_id) then
    raise exception 'team is archived' using errcode = 'P0003';
  end if;

  -- team-local "today" (timezone used only for this boundary, never on bucketing)
  v_today := (pg_catalog.now() at time zone public.safe_team_tz(new.team_id))::date;

  -- 3. no future dates
  if new.session_date > v_today then
    raise exception 'session_date is in the future' using errcode = 'P0004';
  end if;

  -- 4. no backdating beyond 7 days
  if new.session_date < v_today - 7 then
    raise exception 'session_date is more than 7 days in the past' using errcode = 'P0005';
  end if;

  -- 6. category belongs to the logging-context team + is active — checked only
  --    when the category link changes, so archiving a category never freezes
  --    edits (duration/notes) on the sessions that already reference it.
  if tg_op = 'INSERT'
     or new.category_id is distinct from old.category_id
     or new.team_id is distinct from old.team_id then
    if not exists (
      select 1 from public.training_categories c
      where c.id = new.category_id and c.team_id = new.team_id and c.is_active
    ) then
      raise exception 'category does not belong to this team or is archived'
        using errcode = 'P0017';
    end if;
  end if;

  -- 5. daily cap (hard): serialize per player-day, then sum OTHER rows + incoming
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.profile_id::text || new.session_date::text)
  );
  select coalesce(sum(duration_minutes), 0) into v_other_total
    from public.training_sessions
    where profile_id = new.profile_id
      and session_date = new.session_date
      and id <> new.id;
  if v_other_total + new.duration_minutes > 360 then
    raise exception 'daily training cap of 360 minutes exceeded' using errcode = 'P0006';
  end if;

  return new;
end;
$$;

create trigger training_sessions_validate_trg
  before insert or update on public.training_sessions
  for each row execute function public.training_sessions_validate();

-- ── Row Level Security: training_sessions ───────────────────────────────────

alter table public.training_sessions enable row level security;

-- SELECT: self, managed children, staff currently administering any of the
-- player's teams (global visibility), and a director of the logging-context org
-- (historical rows whose context team is archived / player has since left).
create policy "training_sessions_select" on public.training_sessions
  for select using (
    profile_id = auth.uid()
    or public.is_managed_by_me(profile_id)
    or public.is_training_admin_for_profile(profile_id)
    or public.is_org_admin(public.team_org_id(team_id))
  );

-- INSERT: self/managed, roster player, non-archived team, club access.
create policy "training_sessions_insert" on public.training_sessions
  for insert with check (
    (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- UPDATE: same eligibility as insert (keyed to the logging-context team, so a
-- player who left it can't edit); the 7-day edit window is enforced by the
-- trigger. This is the intentional edit-vs-delete asymmetry.
create policy "training_sessions_update" on public.training_sessions
  for update
  using (
    (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  )
  with check (
    team_id is not null
    and category_id is not null
    and (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- DELETE: staff administering any of the player's current teams, or a director
-- of the logging-context org (moderation, no date bound); self/managed only
-- within the 7-day window (a finalized week is immutable to the player).
create policy "training_sessions_delete" on public.training_sessions
  for delete using (
    public.is_training_admin_for_profile(profile_id)
    or public.is_org_admin(public.team_org_id(team_id))
    or (
      (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
      and session_date >= (pg_catalog.now() at time zone public.safe_team_tz(team_id))::date - 7
    )
  );

-- ── Row Level Security: training_categories ─────────────────────────────────

alter table public.training_categories enable row level security;

-- SELECT: any team member (picker), OR any category referenced by a session the
-- caller can already read (cross-team history: resolve a label without gaining
-- the other team's full list). training_sessions RLS applies inside the subquery.
create policy "training_categories_select" on public.training_categories
  for select using (
    public.is_team_member(team_id)
    or exists (
      select 1 from public.training_sessions s
      where s.category_id = training_categories.id
    )
  );

-- INSERT/UPDATE/DELETE: coach/manager (is_team_admin) or org director/owner
-- (is_org_admin), gated by club access. DELETE additionally forbids the default.
create policy "training_categories_insert" on public.training_categories
  for insert with check (
    (public.is_team_admin(team_id) or public.is_org_admin(public.team_org_id(team_id)))
    and public.has_club_access(public.team_org_id(team_id))
  );

create policy "training_categories_update" on public.training_categories
  for update
  using (
    (public.is_team_admin(team_id) or public.is_org_admin(public.team_org_id(team_id)))
    and public.has_club_access(public.team_org_id(team_id))
  )
  with check (
    (public.is_team_admin(team_id) or public.is_org_admin(public.team_org_id(team_id)))
    and public.has_club_access(public.team_org_id(team_id))
  );

create policy "training_categories_delete" on public.training_categories
  for delete using (
    (public.is_team_admin(team_id) or public.is_org_admin(public.team_org_id(team_id)))
    and public.has_club_access(public.team_org_id(team_id))
    and is_default = false
  );

-- ── RPC: training_leaderboard ───────────────────────────────────────────────
-- Ranked GLOBAL totals for a team or club, per week/month. Builds a distinct
-- current-roster player cohort first, then sums each player's sessions by
-- profile_id (never by session.team_id) — so a multi-team player is counted
-- once with their full total. One row PER PLAYER.

create or replace function public.training_leaderboard(
  p_scope   text,
  p_team_id uuid default null,
  p_org_id  uuid default null,
  p_period  text default 'week',
  p_anchor  date default current_date
)
returns table (
  profile_id    uuid,
  display_name  text,
  avatar_url    text,
  team_id       uuid,
  team_name     text,
  total_minutes integer,
  session_count integer,
  rank          integer
)
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_start date;
  v_end   date;   -- exclusive
begin
  if p_scope not in ('team', 'club') then
    raise exception 'invalid scope: %', p_scope using errcode = 'P0007';
  end if;
  if p_period not in ('week', 'month') then
    raise exception 'invalid period: %', p_period using errcode = 'P0007';
  end if;
  if p_scope = 'team' and p_team_id is null then
    raise exception 'p_team_id required for team scope' using errcode = 'P0007';
  end if;
  if p_scope = 'club' and p_org_id is null then
    raise exception 'p_org_id required for club scope' using errcode = 'P0007';
  end if;

  if p_scope = 'team' then
    if not public.is_team_member(p_team_id) then
      raise exception 'not a team member' using errcode = 'P0008';
    end if;
    if not public.has_club_access(public.team_org_id(p_team_id)) then
      raise exception 'no club access' using errcode = 'P0008';
    end if;
  else
    if not (
      public.is_org_admin(p_org_id)
      or exists (
        select 1 from public.teams t
        where t.organization_id = p_org_id
          and t.archived_at is null
          and public.is_team_member(t.id)
      )
    ) then
      raise exception 'not an org member' using errcode = 'P0008';
    end if;
    if not public.has_club_access(p_org_id) then
      raise exception 'no club access' using errcode = 'P0008';
    end if;
    if p_team_id is not null
       and public.team_org_id(p_team_id) is distinct from p_org_id then
      raise exception 'filter team is not in the org' using errcode = 'P0008';
    end if;
  end if;

  if p_period = 'week' then
    v_start := date_trunc('week', p_anchor)::date;   -- Monday
    v_end   := v_start + 7;
  else
    v_start := date_trunc('month', p_anchor)::date;
    v_end   := (v_start + interval '1 month')::date;
  end if;

  return query
  with cohort as (
    -- distinct current roster players in scope
    select distinct tm.profile_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.role = 'player'
      and (
        (p_scope = 'team' and tm.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or tm.team_id = p_team_id))
      )
  ),
  totals as (
    -- each cohort player's GLOBAL sessions in the period (by profile_id only)
    select
      ts.profile_id,
      sum(ts.duration_minutes)::integer as total_minutes,
      count(*)::integer                 as session_count,
      min(ts.session_date)              as first_date
    from public.training_sessions ts
    join cohort c on c.profile_id = ts.profile_id
    where ts.session_date >= v_start
      and ts.session_date <  v_end
    group by ts.profile_id
  )
  select
    p.id as profile_id,
    case
      when p_scope = 'team'
        then btrim(p.first_name || ' ' || coalesce(p.last_name, ''))
      else
        p.first_name || case
          when nullif(btrim(p.last_name), '') is not null
          then ' ' || left(btrim(p.last_name), 1) || '.'
          else ''
        end
    end as display_name,
    p.avatar_url,
    case when p_scope = 'team' or p_team_id is not null then p_team_id end as team_id,
    case when p_scope = 'team' or p_team_id is not null
         then (select tt.name from public.teams tt where tt.id = p_team_id) end as team_name,
    tot.total_minutes,
    tot.session_count,
    rank() over (order by tot.total_minutes desc)::integer as rank
  from totals tot
  join public.profiles p on p.id = tot.profile_id
  where not p.training_leaderboard_opt_out
  order by tot.total_minutes desc, tot.session_count desc,
           tot.first_date asc, p.last_name asc, p.id asc;
end;
$$;

-- ── RPC: training_summary ───────────────────────────────────────────────────
-- The caller's own GLOBAL totals/rank/denominator for the header. Subject is
-- self or a managed child only. total_minutes is the player's global total (the
-- same in every scope they're in); rank/denominator vary by cohort.

create or replace function public.training_summary(
  p_profile_id uuid,
  p_scope      text,
  p_team_id    uuid default null,
  p_org_id     uuid default null,
  p_period     text default 'week',
  p_anchor     date default current_date
)
returns table (
  total_minutes integer,
  session_count integer,
  rank          integer,
  denominator   integer
)
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_start date;
  v_end   date;
begin
  -- Subject authorization (distinct from scope authorization below).
  if not (p_profile_id = auth.uid() or public.is_managed_by_me(p_profile_id)) then
    raise exception 'may only query your own or a managed profile'
      using errcode = 'P0009';
  end if;

  if p_scope not in ('team', 'club') then
    raise exception 'invalid scope: %', p_scope using errcode = 'P0007';
  end if;
  if p_period not in ('week', 'month') then
    raise exception 'invalid period: %', p_period using errcode = 'P0007';
  end if;
  if p_scope = 'team' and p_team_id is null then
    raise exception 'p_team_id required for team scope' using errcode = 'P0007';
  end if;
  if p_scope = 'club' and p_org_id is null then
    raise exception 'p_org_id required for club scope' using errcode = 'P0007';
  end if;

  if p_scope = 'team' then
    if not public.is_team_member(p_team_id) then
      raise exception 'not a team member' using errcode = 'P0008';
    end if;
    if not public.has_club_access(public.team_org_id(p_team_id)) then
      raise exception 'no club access' using errcode = 'P0008';
    end if;
  else
    if not (
      public.is_org_admin(p_org_id)
      or exists (
        select 1 from public.teams t
        where t.organization_id = p_org_id
          and t.archived_at is null
          and public.is_team_member(t.id)
      )
    ) then
      raise exception 'not an org member' using errcode = 'P0008';
    end if;
    if not public.has_club_access(p_org_id) then
      raise exception 'no club access' using errcode = 'P0008';
    end if;
    if p_team_id is not null
       and public.team_org_id(p_team_id) is distinct from p_org_id then
      raise exception 'filter team is not in the org' using errcode = 'P0008';
    end if;
  end if;

  if p_period = 'week' then
    v_start := date_trunc('week', p_anchor)::date;
    v_end   := v_start + 7;
  else
    v_start := date_trunc('month', p_anchor)::date;
    v_end   := (v_start + interval '1 month')::date;
  end if;

  return query
  with cohort as (
    select distinct tm.profile_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.role = 'player'
      and (
        (p_scope = 'team' and tm.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or tm.team_id = p_team_id))
      )
  ),
  -- The board's peer set: non-opted-out cohort players WITH minutes (global).
  board as (
    select ts.profile_id, sum(ts.duration_minutes)::integer as total_minutes
    from public.training_sessions ts
    join cohort c on c.profile_id = ts.profile_id
    join public.profiles p on p.id = ts.profile_id
    where ts.session_date >= v_start
      and ts.session_date <  v_end
      and not p.training_leaderboard_opt_out
    group by ts.profile_id
  ),
  -- The subject's own GLOBAL totals in the period (opt-out irrelevant: own view).
  self_totals as (
    select
      coalesce(sum(ts.duration_minutes), 0)::integer as total_minutes,
      count(*)::integer                              as session_count
    from public.training_sessions ts
    where ts.profile_id = p_profile_id
      and ts.session_date >= v_start
      and ts.session_date <  v_end
  ),
  -- Rank over the board PLUS the subject (so an opted-out subject still gets a
  -- hypothetical rank). A zero-minute subject is not added, so their rank is null.
  ranked as (
    select u.profile_id, rank() over (order by u.total_minutes desc)::integer as rank
    from (
      select b.profile_id, b.total_minutes from board b
      union
      select p_profile_id, st.total_minutes
      from self_totals st where st.total_minutes > 0
    ) u
  ),
  -- Peer-cohort size: distinct non-opted-out roster players in scope.
  cohort_count as (
    select count(distinct c.profile_id)::integer as denominator
    from cohort c
    join public.profiles p on p.id = c.profile_id
    where not p.training_leaderboard_opt_out
  )
  select
    st.total_minutes,
    st.session_count,
    (select r.rank from ranked r where r.profile_id = p_profile_id) as rank,
    cc.denominator
  from self_totals st, cohort_count cc;
end;
$$;

-- ── Security-definer hygiene: EXECUTE grants ────────────────────────────────
-- Callable helpers/RPCs: revoke anon/public, keep authenticated (helpers run
-- inside RLS policies; RPCs are called directly). Trigger functions are never
-- invoked by clients: revoke from anon, authenticated, and public.

revoke execute on function public.is_team_player(uuid, uuid)                 from anon, public;
revoke execute on function public.is_team_archived(uuid)                     from anon, public;
revoke execute on function public.safe_team_tz(uuid)                         from anon, public;
revoke execute on function public.has_club_access(uuid)                      from anon, public;
revoke execute on function public.is_training_admin_for_profile(uuid)        from anon, public;
revoke execute on function public.training_leaderboard(text, uuid, uuid, text, date)     from anon, public;
revoke execute on function public.training_summary(uuid, text, uuid, uuid, text, date)   from anon, public;

grant execute on function public.is_team_player(uuid, uuid)                  to authenticated;
grant execute on function public.is_team_archived(uuid)                      to authenticated;
grant execute on function public.safe_team_tz(uuid)                          to authenticated;
grant execute on function public.has_club_access(uuid)                       to authenticated;
grant execute on function public.is_training_admin_for_profile(uuid)         to authenticated;
grant execute on function public.training_leaderboard(text, uuid, uuid, text, date)      to authenticated;
grant execute on function public.training_summary(uuid, text, uuid, uuid, text, date)    to authenticated;

revoke execute on function public.training_sessions_validate()      from anon, authenticated, public;
revoke execute on function public.training_categories_guard()       from anon, authenticated, public;
revoke execute on function public.seed_team_default_category()      from anon, authenticated, public;
