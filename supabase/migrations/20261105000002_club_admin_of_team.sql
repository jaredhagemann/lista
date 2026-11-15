-- BUG-046, review fixes (docs/reviews/2026-11-05-pr159-review.md).
--
-- 1. The trigger read the directorship without a lock, so a role edit could
--    give someone a `director` row while remove_org_director was taking their
--    directorship away, and the row outlived it. Every check now goes through
--    club_admin_of_team, which locks the qualifying organization_members row
--    FOR SHARE. remove_org_director deletes that row first, so either it waits
--    for the role edit and then deletes the new `director` row, or the role
--    edit waits for it and is refused.
--
-- 2. create_team records a standalone team's creator as the owner of its free
--    organization. That isn't a club directorship, so an owner counts only
--    while the organization is on a Club plan. A director always counts: only
--    a club invites directors.
--
-- 3. POST /api/club/teams enrolled the owners and directors it had read
--    before creating the team. If one left in between, the trigger refused the
--    whole insert and the creator wasn't enrolled. enroll_club_admins enrolls
--    whoever qualifies when it runs, and create_club_team uses it too.

create or replace function club_admin_of_team(p_team_id uuid, p_profile_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform 1
  from organization_members om
  join teams t on t.organization_id = om.organization_id
  join organizations o on o.id = om.organization_id
  where t.id = p_team_id
    and om.profile_id = p_profile_id
    and (om.role = 'director'
         or (om.role = 'owner' and o.plan in ('club_small', 'club_large')))
  for share of om;
  return found;
end;
$$;

revoke execute on function club_admin_of_team(uuid, uuid) from public, anon, authenticated;
grant execute on function club_admin_of_team(uuid, uuid) to service_role;

create or replace function refuse_director_row_without_directorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'director'
     and (tg_op = 'INSERT' or old.role is distinct from 'director')
     and not club_admin_of_team(new.team_id, new.profile_id) then
    raise exception 'NOT_A_CLUB_DIRECTOR: only an owner or director of the club can have the director role on a team'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function remove_team_member_role(p_member_id uuid, p_team_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_role text;
begin
  if not is_team_admin(p_team_id) then
    raise exception 'NOT_AUTHORIZED: only a team admin can remove members' using errcode = '42501';
  end if;

  select profile_id, role into v_profile, v_role
  from team_members
  where id = p_member_id and team_id = p_team_id
  for update;
  if not found then
    return 'not_found';
  end if;

  if v_role = 'director' then
    return 'director_row';
  end if;

  if not club_admin_of_team(p_team_id, v_profile) then
    return 'not_club_admin';
  end if;

  update team_members set role = 'director' where id = p_member_id;
  return 'kept_as_director';
end;
$$;

-- Returns the profiles enrolled.
create or replace function enroll_club_admins(p_team_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled uuid[];
begin
  -- Lock everyone who qualifies, so nobody's directorship ends mid-insert.
  perform 1
  from organization_members om
  join teams t on t.organization_id = om.organization_id
  join organizations o on o.id = om.organization_id
  where t.id = p_team_id
    and (om.role = 'director'
         or (om.role = 'owner' and o.plan in ('club_small', 'club_large')))
  for share of om;

  with enrolled as (
    insert into team_members (team_id, profile_id, role)
    select p_team_id, om.profile_id, 'director'
    from organization_members om
    join teams t on t.organization_id = om.organization_id
    join organizations o on o.id = om.organization_id
    where t.id = p_team_id
      and (om.role = 'director'
           or (om.role = 'owner' and o.plan in ('club_small', 'club_large')))
    on conflict (team_id, profile_id) do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into v_enrolled from enrolled;

  return v_enrolled;
end;
$$;

revoke execute on function enroll_club_admins(uuid) from public, anon, authenticated;
grant execute on function enroll_club_admins(uuid) to service_role;

-- The body of 20260924000000_director_invitations.sql, except that enrollment
-- goes through enroll_club_admins.
CREATE OR REPLACE FUNCTION create_club_team(
  org_id    uuid,
  team_name text,
  season    text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id      uuid := gen_random_uuid();
  v_profile_id   uuid;
  v_caller_role  text;
  v_team_limit   integer;
  v_team_count   integer;
BEGIN
  -- Resolve caller's profile from auth.uid()
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE auth_user_id = auth.uid();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify caller is an owner or director in the target org
  SELECT role INTO v_caller_role
  FROM organization_members
  WHERE organization_id = org_id
    AND profile_id = v_profile_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'caller is not an owner or director of this organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Enforce the per-org team limit. A NULL limit (club_large) means unlimited
  -- and is never blocked. Only ACTIVE (non-archived) teams count against the
  -- cap — archiving is a spec-prescribed remedy and must actually free a slot.
  SELECT team_limit INTO v_team_limit
  FROM organizations
  WHERE id = org_id;

  IF v_team_limit IS NOT NULL THEN
    SELECT count(*) INTO v_team_count
    FROM teams
    WHERE organization_id = org_id
      AND archived_at IS NULL;

    IF v_team_count >= v_team_limit THEN
      RAISE EXCEPTION 'You''ve reached your plan limit of % teams.', v_team_limit;
    END IF;
  END IF;

  -- Create the team (fires create_team_channel trigger → provisions channels row)
  INSERT INTO teams (id, organization_id, name, season, owner_id)
  VALUES (
    v_team_id,
    org_id,
    TRIM(team_name),
    NULLIF(TRIM(season), ''),
    v_profile_id
  );

  -- Every owner and director joins the roster (BUG-013), as POST /api/club/teams
  -- does: they appear on it, receive team notifications and have team chat.
  -- enroll_club_admins decides who counts (BUG-046).
  PERFORM enroll_club_admins(v_team_id);

  -- Update caller's active team
  UPDATE profiles
  SET active_team_id = v_team_id
  WHERE id = v_profile_id;

  RETURN v_team_id;
END;
$$;
