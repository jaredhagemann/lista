-- BUG-013, part 1: inviting and removing club directors.
--
-- Club settings has shipped Invite director and Remove director controls whose
-- routes never existed. Decisions (2026-09-24, recorded on the ticket):
--   - an invitation is emailed and becomes a directorship only when accepted,
--     through the same accept_invitation as every other invitation
--   - accepting adds the director to every active team in the club: the
--     dashboard and club portal are reached through a team
--   - only the owner removes a director; the director's teams pass to the owner,
--     their 'director' roster rows go, any other role they hold stays
--
--   1. invitations.organization_id, and the 'director' role on invitations.
--   2. create_director_invitation: owner check, "already a member", reuse of a
--      pending invitation, and the insert, in one transaction.
--   3. accept_invitation accepts a director invitation as 'self'.
--   4. remove_org_director.
--   5. create_club_team enrolls every owner and director, as POST /api/club/teams
--      already does.
--
-- create_director_invitation and remove_org_director take the acting user's id
-- from the API route, which authenticates the request; like accept_invitation,
-- no client role may execute them.

-- ── 1. Club invitations ──────────────────────────────────────────────────────

alter table invitations
  add column organization_id uuid references organizations(id) on delete cascade;

alter table invitations drop constraint invitations_role_check;
alter table invitations add constraint invitations_role_check
  check (role in ('coach', 'manager', 'player', 'director'));

-- A director invitation is to a club, never a team or a child; every other
-- invitation is to a team.
alter table invitations add constraint invitations_scope_check check (
  (role = 'director' and organization_id is not null and team_id is null and managed_profile_id is null)
  or (role <> 'director' and organization_id is null)
);

-- One pending director invitation per club and address.
create unique index invitations_one_pending_director
  on invitations (organization_id, lower(btrim(email)))
  where role = 'director' and accepted_at is null;

-- ── 2. Inviting ──────────────────────────────────────────────────────────────

create or replace function create_director_invitation(
  p_actor_id uuid,
  p_org_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED: only the club owner can invite directors' using errcode = '42501';
  end if;

  if exists (
    select 1
    from organization_members om
    join auth.users u on u.id = om.profile_id
    where om.organization_id = p_org_id and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'ALREADY_MEMBER: % is already the owner or a director of this club', v_email
      using errcode = '23505';
  end if;

  -- Asking again sends the same invitation again.
  select id into v_id
  from invitations
  where organization_id = p_org_id
    and role = 'director'
    and accepted_at is null
    and lower(btrim(email)) = v_email
  for update;
  if found then
    return jsonb_build_object('invitation_id', v_id, 'resent', true);
  end if;

  insert into invitations (email, role, organization_id, invited_by)
  values (v_email, 'director', p_org_id, p_actor_id)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'resent', false);
end;
$$;

revoke execute on function create_director_invitation(uuid, uuid, text) from public, anon, authenticated;

-- ── 3. Accepting ─────────────────────────────────────────────────────────────

create or replace function accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_mode text,
  p_relationship text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_managed_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invitations%rowtype;
  recipient_email text;
  player_id uuid;
  member_id uuid;
  landing_team uuid;
begin
  -- Lock first: concurrent acceptances serialize here, and every one after the
  -- first sees accepted_at already set.
  select * into inv from invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'INVITATION_NOT_FOUND';
  end if;
  if inv.accepted_at is not null then
    raise exception 'INVITATION_ALREADY_ACCEPTED';
  end if;

  select email into recipient_email from auth.users where id = p_user_id;
  if recipient_email is null or lower(btrim(recipient_email)) <> lower(btrim(inv.email)) then
    raise exception 'INVITATION_WRONG_RECIPIENT';
  end if;

  if not (
    (inv.managed_profile_id is not null and p_mode = 'manager')
    or (inv.role = 'director' and inv.organization_id is not null and p_mode = 'self')
    or (
      inv.managed_profile_id is null
      and inv.team_id is not null
      and (p_mode = 'self' or (p_mode = 'guardian' and inv.role = 'player'))
    )
  ) then
    raise exception 'INVITATION_WRONG_TYPE: % cannot be accepted as %',
      case when inv.managed_profile_id is not null then 'a guardian invitation' else inv.role || ' invitation' end,
      p_mode;
  end if;

  -- A club directorship (BUG-013): the club role, and a place on every active
  -- team, since the dashboard and club portal are reached through a team. A role
  -- the recipient already holds on a team is kept.
  if inv.role = 'director' then
    insert into organization_members (organization_id, profile_id, role)
    values (inv.organization_id, p_user_id, 'director')
    on conflict (organization_id, profile_id) do nothing;

    insert into team_members (team_id, profile_id, role)
    select t.id, p_user_id, 'director'
    from teams t
    where t.organization_id = inv.organization_id and t.archived_at is null
    on conflict (team_id, profile_id) do nothing;

    select t.id into landing_team
    from teams t
    where t.organization_id = inv.organization_id and t.archived_at is null
    order by t.created_at, t.id
    limit 1;

    if landing_team is not null then
      update profiles set active_team_id = landing_team where id = p_user_id;
      select id into member_id
      from team_members
      where team_id = landing_team and profile_id = p_user_id;
    end if;

    update invitations set accepted_at = now() where id = inv.id;

    return jsonb_build_object(
      'team_id', landing_team,
      'team_member_id', member_id,
      'managed_profile_id', null,
      'organization_id', inv.organization_id
    );
  end if;

  -- Naming an existing child only means something for guardian acceptance, and
  -- only for a child this caller actually manages.
  if p_mode = 'guardian' and p_managed_profile_id is not null then
    if not exists (
      select 1 from profile_managers
      where manager_id = p_user_id
        and managed_id = p_managed_profile_id
        and managed_id <> manager_id
    ) then
      raise exception 'NOT_YOUR_MANAGED_PROFILE' using errcode = '42501';
    end if;
  end if;

  if p_mode = 'manager' then
    insert into profile_managers (manager_id, managed_id, relationship)
    values (p_user_id, inv.managed_profile_id, inv.relationship)
    on conflict (manager_id, managed_id) do nothing;
    player_id := inv.managed_profile_id;

  elsif p_mode = 'self' then
    insert into team_members (team_id, profile_id, role)
    values (inv.team_id, p_user_id, inv.role)
    on conflict (team_id, profile_id) do nothing;

    select id into member_id
    from team_members
    where team_id = inv.team_id and profile_id = p_user_id;

    update profiles
    set birthday = coalesce(inv.birthday, birthday),
        gender = coalesce(inv.gender, gender),
        active_team_id = inv.team_id
    where id = p_user_id;

  else -- guardian
    if p_managed_profile_id is not null then
      -- One identity, a second membership (BUG-011).
      player_id := p_managed_profile_id;

      -- Fill in what the child is missing; never overwrite what the guardian
      -- already recorded with the coach's version of it.
      update profiles
      set birthday = coalesce(birthday, inv.birthday),
          gender = coalesce(gender, inv.gender)
      where id = player_id;
    else
      player_id := gen_random_uuid();

      insert into profiles (id, first_name, last_name, email, birthday, gender)
      values (
        player_id,
        coalesce(inv.first_name, ''),
        coalesce(inv.last_name, ''),
        'managed-' || player_id || '@lista.internal',
        inv.birthday,
        inv.gender
      );

      insert into profile_managers (manager_id, managed_id, relationship)
      values (p_user_id, player_id, p_relationship);
    end if;

    insert into team_members (team_id, profile_id, role)
    values (inv.team_id, player_id, inv.role)
    on conflict (team_id, profile_id) do nothing;

    select id into member_id
    from team_members
    where team_id = inv.team_id and profile_id = player_id;

    update profiles
    set first_name = coalesce(nullif(p_first_name, ''), first_name),
        last_name = coalesce(nullif(p_last_name, ''), last_name),
        active_team_id = inv.team_id
    where id = p_user_id;
  end if;

  update invitations set accepted_at = now() where id = inv.id;

  return jsonb_build_object(
    'team_id', inv.team_id,
    'team_member_id', member_id,
    'managed_profile_id', player_id
  );
end;
$$;

-- ── 4. Removing ──────────────────────────────────────────────────────────────

create or replace function remove_org_director(
  p_actor_id uuid,
  p_org_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner
  from organization_members
  where organization_id = p_org_id and role = 'owner'
  for update;
  if v_owner is null or v_owner <> p_actor_id then
    raise exception 'NOT_AUTHORIZED: only the club owner can remove directors' using errcode = '42501';
  end if;

  -- Only a director: the owner leaves only by transferring ownership.
  delete from organization_members
  where organization_id = p_org_id and profile_id = p_profile_id and role = 'director';
  if not found then
    raise exception 'NOT_A_DIRECTOR' using errcode = 'P0002';
  end if;

  -- Their teams pass to the owner.
  update teams set owner_id = v_owner
  where organization_id = p_org_id and owner_id = p_profile_id;

  -- The places the directorship gave them; any other role stays.
  delete from team_members tm
  using teams t
  where tm.team_id = t.id
    and t.organization_id = p_org_id
    and tm.profile_id = p_profile_id
    and tm.role = 'director';

  -- An active team they can no longer reach would strand them on it.
  update profiles p
  set active_team_id = null
  where p.id = p_profile_id
    and p.active_team_id in (select id from teams where organization_id = p_org_id)
    and not exists (
      select 1 from team_members tm
      where tm.team_id = p.active_team_id and tm.profile_id = p_profile_id
    );
end;
$$;

revoke execute on function remove_org_director(uuid, uuid, uuid) from public, anon, authenticated;

-- ── 5. New teams include every director ─────────────────────────────────────

-- The body of 20260521000000_create_club_team_active_count.sql, except that
-- every owner and director is enrolled, not just the caller.
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
  INSERT INTO team_members (team_id, profile_id, role)
  SELECT v_team_id, om.profile_id, 'director'
  FROM organization_members om
  WHERE om.organization_id = org_id
    AND om.role IN ('owner', 'director');

  -- Update caller's active team
  UPDATE profiles
  SET active_team_id = v_team_id
  WHERE id = v_profile_id;

  RETURN v_team_id;
END;
$$;
