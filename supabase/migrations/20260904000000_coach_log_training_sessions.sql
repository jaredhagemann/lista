-- Coach-logged training sessions (docs/specs/coach-log-training.md).
--
-- Let a team's coaches/managers, and org directors/owners, log/edit training
-- sessions on behalf of roster players (incl. managed, no-auth players). The
-- DELETE policy already permitted admins; this migration:
--   1. adds an admin branch to the INSERT and UPDATE policies, tied to the
--      logging-context team_id;
--   2. exempts those admins from the 7-day backdate floor in the validation
--      trigger (mirroring the admin delete-anytime moderation model). Future
--      dates, the 360-min/day cap, roster/archived/category checks stay for all.
--
-- created_by is still stamped from the caller (so a coach-created row records
-- the coach) and is immutable on update (a coach editing a player-created row
-- leaves created_by = the player). There is no updated_by in v1.

-- ── INSERT: self/managed OR admin of the context team ───────────────────────
drop policy if exists "training_sessions_insert" on public.training_sessions;
create policy "training_sessions_insert" on public.training_sessions
  for insert with check (
    (
      profile_id = auth.uid()
      or public.is_managed_by_me(profile_id)
      or public.is_team_admin(team_id)
      or public.is_org_admin(public.team_org_id(team_id))
    )
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- ── UPDATE: same admin addition in both USING and WITH CHECK ─────────────────
drop policy if exists "training_sessions_update" on public.training_sessions;
create policy "training_sessions_update" on public.training_sessions
  for update
  using (
    (
      profile_id = auth.uid()
      or public.is_managed_by_me(profile_id)
      or public.is_team_admin(team_id)
      or public.is_org_admin(public.team_org_id(team_id))
    )
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  )
  with check (
    team_id is not null
    and category_id is not null
    and (
      profile_id = auth.uid()
      or public.is_managed_by_me(profile_id)
      or public.is_team_admin(team_id)
      or public.is_org_admin(public.team_org_id(team_id))
    )
    and public.is_team_player(team_id, profile_id)
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );

-- ── Validation trigger: exempt admins from the backdate floor (rule 4) ───────
-- Full-body replace: identical to 20260713000000_training_sessions.sql except
-- rule 4 now skips the 7-day floor for a training admin of the context team.
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

  -- 3. no future dates (everyone, admins included — a session can't have happened yet)
  if new.session_date > v_today then
    raise exception 'session_date is in the future' using errcode = 'P0004';
  end if;

  -- 4. no backdating beyond 7 days — EXEMPT a training admin of the context team
  --    (coach/manager/director on the team, or an org owner/director) so staff
  --    can backfill older sessions, mirroring the admin delete-anytime
  --    moderation model. auth.uid() is null for service-role writes, so those
  --    get no exemption (they use current dates anyway).
  --
  --    The admin check is inlined and fully schema-qualified rather than calling
  --    public.is_team_admin / public.is_org_admin, because those shared helpers
  --    reference their tables unqualified and this trigger runs with
  --    search_path = '' (they would raise "relation team_members does not
  --    exist"). Semantics mirror is_team_admin; rule 2 already excluded archived
  --    teams.
  if new.session_date < v_today - 7
     and not (
       exists (
         select 1
         from public.team_members tm
         join public.profiles p on p.id = tm.profile_id
         where tm.team_id = new.team_id
           and p.auth_user_id = auth.uid()
           and tm.role in ('coach', 'manager', 'director')
       )
       or exists (
         select 1
         from public.teams t
         join public.organization_members om on om.organization_id = t.organization_id
         join public.profiles p on p.id = om.profile_id
         where t.id = new.team_id
           and p.auth_user_id = auth.uid()
           and om.role in ('owner', 'director')
       )
     ) then
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
