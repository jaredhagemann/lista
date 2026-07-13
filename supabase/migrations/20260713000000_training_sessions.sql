-- ============================================================================
-- Individual Training Tracking & Leaderboard
-- Spec: docs/specs/individual-training-tracking.md
-- ----------------------------------------------------------------------------
-- Club-tier feature: players log individual training (date, duration, category,
-- note) and see per-week / per-month leaderboards for their team and club.
--
-- All helper/RPC functions here are SECURITY DEFINER (they bypass RLS for
-- membership/plan lookups and the club-board privilege escalation) and are
-- therefore declared `set search_path = ''` with every reference schema-
-- qualified — see "Security-definer hygiene" in the spec.
-- ============================================================================

-- ── Table: training_sessions ────────────────────────────────────────────────

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),

  -- The player the session belongs to. For a parent logging on behalf of a
  -- child this is the CHILD's profile, not the parent's.
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- The team the session is credited to (the player picks when on >1 team).
  team_id uuid not null references public.teams(id) on delete cascade,

  -- The day the training happened, as the player reports it. A `date`, not a
  -- timestamptz: bucketing is timezone-naive (see leaderboard RPC).
  session_date date not null,

  duration_minutes integer not null check (duration_minutes between 5 and 300),

  category text not null check (category in (
    'ball_mastery', 'dribbling', 'passing', 'shooting',
    'fitness', 'strength', 'agility', 'recovery', 'other'
  )),

  notes text check (char_length(notes) <= 500),

  -- Who actually entered the row. Stamped by the validation trigger from the
  -- calling profile for authenticated callers (unforgeable); the service role
  -- (auth.uid() null) supplies it explicitly when seeding.
  created_by uuid not null references public.profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leaderboard aggregation is always (team | set of teams) × date range.
create index training_sessions_team_date_idx
  on public.training_sessions (team_id, session_date desc);

-- "My training" list and the per-player coach drill-down + daily-cap sum.
create index training_sessions_profile_date_idx
  on public.training_sessions (profile_id, session_date desc);

-- ── Column: profiles.training_leaderboard_opt_out ───────────────────────────

alter table public.profiles
  add column training_leaderboard_opt_out boolean not null default false;

-- ── Helper functions ────────────────────────────────────────────────────────

-- Is p_id a roster PLAYER on team t_id? Role-only by design (archived-ness is
-- handled separately so aggregation can still surface an archived team's board
-- to its director).
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

-- ── Validation trigger ──────────────────────────────────────────────────────

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
    -- Stamp created_by from the caller (unforgeable). Only when there IS an
    -- authenticated caller; the service role (auth.uid() null) supplies it
    -- explicitly and the NOT NULL constraint enforces its presence.
    if auth.uid() is not null then
      new.created_by := (select id from public.profiles where auth_user_id = auth.uid());
      if new.created_by is null then
        raise exception 'no calling profile' using errcode = 'P0001';
      end if;
    end if;
  else
    new.updated_at := pg_catalog.now();
  end if;

  -- 1. must be a roster player on the team
  if not public.is_team_player(new.team_id, new.profile_id) then
    raise exception 'profile is not a player on this team'
      using errcode = 'P0002';
  end if;

  -- 2. team must not be archived
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
    raise exception 'session_date is more than 7 days in the past'
      using errcode = 'P0005';
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
    raise exception 'daily training cap of 360 minutes exceeded'
      using errcode = 'P0006';
  end if;

  return new;
end;
$$;

create trigger training_sessions_validate_trg
  before insert or update on public.training_sessions
  for each row execute function public.training_sessions_validate();

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.training_sessions enable row level security;

-- SELECT: self, managed children, and team admins (coach/manager/director).
create policy "training_sessions_select" on public.training_sessions
  for select using (
    profile_id = auth.uid()
    or public.is_managed_by_me(profile_id)
    or public.is_team_admin(team_id)
  );

-- INSERT: self/managed, roster player, non-archived team, club access.
create policy "training_sessions_insert" on public.training_sessions
  for insert with check (
    (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- UPDATE: same as insert; the 7-day edit window is enforced by the trigger.
create policy "training_sessions_update" on public.training_sessions
  for update
  using (
    (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  )
  with check (
    (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- DELETE: team admins any time (moderation); self/managed only within the 7-day
-- window, so a finalized week is immutable to the player.
create policy "training_sessions_delete" on public.training_sessions
  for delete using (
    public.is_team_admin(team_id)
    or (
      (profile_id = auth.uid() or public.is_managed_by_me(profile_id))
      and session_date >= (pg_catalog.now() at time zone public.safe_team_tz(team_id))::date - 7
    )
  );

-- ── RPC: training_leaderboard ───────────────────────────────────────────────
-- Ranked totals for a team or the whole club, per week/month. One row PER
-- PLAYER (never per player-team). Club scope is a deliberate privilege
-- escalation gated by an explicit caller check.

create or replace function public.training_leaderboard(
  p_scope   text,
  p_team_id uuid,
  p_org_id  uuid,
  p_period  text,
  p_anchor  date
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
-- `public` (not '') because this RPC calls the pre-existing helpers
-- is_team_member/is_org_admin/team_org_id, which are not yet search_path-pinned
-- (repo-wide backfill = Open Question 7) and would otherwise inherit an empty
-- path and fail to resolve their own unqualified tables. This function's OWN
-- object references are still fully schema-qualified, so its code stays safe.
set search_path = public
as $$
declare
  v_start date;
  v_end   date;   -- exclusive
begin
  -- Parameter validation
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

  -- Caller check (org derived from a trusted source, never an interchangeable param)
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

  -- Period bounds (timezone-naive on session_date)
  if p_period = 'week' then
    v_start := date_trunc('week', p_anchor)::date;   -- Monday
    v_end   := v_start + 7;
  else
    v_start := date_trunc('month', p_anchor)::date;
    v_end   := (v_start + interval '1 month')::date;
  end if;

  return query
  with rows as (
    select
      p.id                                             as profile_id,
      case
        when p_scope = 'team' then
          btrim(p.first_name || ' ' || coalesce(p.last_name, ''))
        else
          p.first_name || case
            when nullif(btrim(p.last_name), '') is not null
            then ' ' || left(btrim(p.last_name), 1) || '.'
            else ''
          end
      end                                              as display_name,
      p.avatar_url                                     as avatar_url,
      case when p_scope = 'team' or p_team_id is not null
           then coalesce(p_team_id, ts.team_id) end    as team_id,
      sum(ts.duration_minutes)::integer                as total_minutes,
      count(*)::integer                                as session_count,
      min(ts.session_date)                             as first_date,
      p.last_name                                      as last_name
    from public.training_sessions ts
    join public.team_members tm
      on tm.team_id = ts.team_id
     and tm.profile_id = ts.profile_id
     and tm.role = 'player'
    join public.teams t
      on t.id = ts.team_id
    join public.profiles p
      on p.id = ts.profile_id
    where ts.session_date >= v_start
      and ts.session_date <  v_end
      and not p.training_leaderboard_opt_out
      and (
        (p_scope = 'team' and ts.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or ts.team_id = p_team_id))
      )
    group by p.id, p.first_name, p.last_name, p.avatar_url,
             case when p_scope = 'team' or p_team_id is not null
                  then coalesce(p_team_id, ts.team_id) end
  )
  select
    r.profile_id,
    r.display_name,
    r.avatar_url,
    r.team_id,
    (select tm2.name from public.teams tm2 where tm2.id = r.team_id) as team_name,
    r.total_minutes,
    r.session_count,
    -- Rank ties on total_minutes (two equal totals share a rank: 1, 2, 2, 4).
    -- The remaining keys order the DISPLAY within a tie, not the rank number.
    rank() over (order by r.total_minutes desc)::integer as rank
  from rows r
  order by r.total_minutes desc, r.session_count desc,
           r.first_date asc, r.last_name asc, r.profile_id asc;
end;
$$;

-- ── RPC: training_summary ───────────────────────────────────────────────────
-- The caller's own totals/rank/denominator for the header. Subject-restricted:
-- self or a managed child only (never another player) — otherwise it would leak
-- an opted-out player's standing.

create or replace function public.training_summary(
  p_profile_id uuid,
  p_scope      text,
  p_team_id    uuid,
  p_org_id     uuid,
  p_period     text,
  p_anchor     date
)
returns table (
  total_minutes integer,
  session_count integer,
  rank          integer,
  denominator   integer
)
language plpgsql security definer stable
-- `public` (not '') because this RPC calls the pre-existing helpers
-- is_team_member/is_org_admin/team_org_id, which are not yet search_path-pinned
-- (repo-wide backfill = Open Question 7) and would otherwise inherit an empty
-- path and fail to resolve their own unqualified tables. This function's OWN
-- object references are still fully schema-qualified, so its code stays safe.
set search_path = public
as $$
declare
  v_start date;
  v_end   date;
begin
  -- Subject authorization (distinct from scope authorization below)
  if not (p_profile_id = auth.uid() or public.is_managed_by_me(p_profile_id)) then
    raise exception 'may only query your own or a managed profile'
      using errcode = 'P0009';
  end if;

  -- Parameter validation + scope caller check: reuse training_leaderboard by
  -- computing over the same ranked set. Validate here as well so a malformed
  -- call fails loudly even if the board query below would be empty.
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
  with
  -- The board's peer set: non-opted-out current-roster players WITH minutes.
  board as (
    select
      p.id                              as profile_id,
      sum(ts.duration_minutes)::integer as total_minutes,
      count(*)::integer                 as session_count,
      min(ts.session_date)              as first_date,
      p.last_name                       as last_name
    from public.training_sessions ts
    join public.team_members tm
      on tm.team_id = ts.team_id
     and tm.profile_id = ts.profile_id
     and tm.role = 'player'
    join public.teams t
      on t.id = ts.team_id
    join public.profiles p
      on p.id = ts.profile_id
    where ts.session_date >= v_start
      and ts.session_date <  v_end
      and not p.training_leaderboard_opt_out
      and (
        (p_scope = 'team' and ts.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or ts.team_id = p_team_id))
      )
    group by p.id, p.last_name
  ),
  -- The subject's own totals in scope (opt-out irrelevant — it's their own view).
  self_totals as (
    select
      coalesce(sum(ts.duration_minutes), 0)::integer as total_minutes,
      count(*)::integer                              as session_count,
      min(ts.session_date)                           as first_date,
      (select pr.last_name from public.profiles pr where pr.id = p_profile_id) as last_name
    from public.training_sessions ts
    join public.team_members tm
      on tm.team_id = ts.team_id
     and tm.profile_id = ts.profile_id
     and tm.role = 'player'
    join public.teams t
      on t.id = ts.team_id
    where ts.profile_id = p_profile_id
      and ts.session_date >= v_start
      and ts.session_date <  v_end
      and (
        (p_scope = 'team' and ts.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or ts.team_id = p_team_id))
      )
  ),
  -- Rank over the board PLUS the subject (so an opted-out subject still gets a
  -- hypothetical rank). The subject is added only when they have minutes; a
  -- non-opted-out subject already in `board` dedups away via UNION. A zero-minute
  -- subject is not added, so their rank lookup below is null.
  ranked_plus as (
    select
      u.profile_id,
      -- Rank ties on total_minutes, matching training_leaderboard.
      rank() over (order by u.total_minutes desc)::integer as rank
    from (
      select b.profile_id, b.total_minutes, b.session_count, b.first_date, b.last_name
      from board b
      union
      select p_profile_id, st.total_minutes, st.session_count, st.first_date, st.last_name
      from self_totals st
      where st.total_minutes > 0
    ) u
  ),
  -- Peer-cohort size: distinct non-opted-out current-roster players in scope,
  -- zero-minute included, opted-out EXCLUDED.
  cohort as (
    select count(distinct tm.profile_id)::integer as denominator
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.profiles p on p.id = tm.profile_id
    where tm.role = 'player'
      and not p.training_leaderboard_opt_out
      and (
        (p_scope = 'team' and tm.team_id = p_team_id)
        or (p_scope = 'club'
            and t.organization_id = p_org_id
            and t.archived_at is null
            and (p_team_id is null or tm.team_id = p_team_id))
      )
  )
  select
    st.total_minutes,
    st.session_count,
    (select rp.rank from ranked_plus rp where rp.profile_id = p_profile_id) as rank,
    c.denominator
  from self_totals st, cohort c;
end;
$$;

-- ── Security-definer hygiene: EXECUTE grants ────────────────────────────────
-- Revoke from anon/public; keep authenticated (helpers run inside RLS policies,
-- RPCs are called directly by clients). NOT the create_team service-role-only
-- pattern — authorization is enforced by the in-function checks above.

revoke execute on function public.is_team_player(uuid, uuid)          from anon, public;
revoke execute on function public.is_team_archived(uuid)              from anon, public;
revoke execute on function public.safe_team_tz(uuid)                  from anon, public;
revoke execute on function public.has_club_access(uuid)               from anon, public;
revoke execute on function public.training_leaderboard(text, uuid, uuid, text, date) from anon, public;
revoke execute on function public.training_summary(uuid, text, uuid, uuid, text, date) from anon, public;

grant execute on function public.is_team_player(uuid, uuid)           to authenticated;
grant execute on function public.is_team_archived(uuid)               to authenticated;
grant execute on function public.safe_team_tz(uuid)                   to authenticated;
grant execute on function public.has_club_access(uuid)                to authenticated;
grant execute on function public.training_leaderboard(text, uuid, uuid, text, date) to authenticated;
grant execute on function public.training_summary(uuid, text, uuid, uuid, text, date) to authenticated;
