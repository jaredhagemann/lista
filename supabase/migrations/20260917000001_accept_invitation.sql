-- BUG-012: invitation acceptance as one transactional, one-time operation.
--
-- The web server actions and POST /api/invite/[id]/accept each did check-then-
-- write with the service role. Three defects followed:
--   • the server actions never checked the recipient, so anyone holding an
--     invitation ID could accept it (the API route did check)
--   • nothing tied the acceptance path to the invitation's kind. A guardian
--     invitation is stored with role 'manager', the same string as the team
--     manager staff role, so accepting it "as self" made the recipient team
--     staff. The guardian path also accepted coach and guardian invitations.
--   • accepted_at was read, then written after the other inserts, so concurrent
--     acceptances all succeeded (on the guardian path: duplicate players)
--
-- accept_invitation locks the invitation row, validates recipient and kind, does
-- every write and marks the invitation accepted in a single transaction. It is
-- callable only by the service role; callers pass the authenticated user's id.
--
-- Each invitation kind has exactly one acceptance path:
--   managed_profile_id set          → 'manager'   link to that existing player
--   role 'player'                   → 'self'      join the team as the player
--                                   → 'guardian'  create the player, link as guardian
--   role 'coach' / 'manager'        → 'self'      join the team as staff

create or replace function accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_mode text,
  p_relationship text default null,
  p_first_name text default null,
  p_last_name text default null
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

  else -- guardian: create the player the invitation describes
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

    insert into team_members (team_id, profile_id, role)
    values (inv.team_id, player_id, inv.role)
    returning id into member_id;

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

revoke execute on function accept_invitation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function accept_invitation(uuid, uuid, text, text, text, text) to service_role;

-- Creation side of the same defect: a guardian invitation grants guardianship
-- only, so its role is always 'manager' (what the web and mobile clients send)
-- and never a team role. Enforced for every writer, service role included.
-- NOT VALID: applies to new and updated rows without failing on any existing
-- row; accept_invitation already refuses to redeem one as a team role.
alter table invitations
  add constraint invitations_guardian_role_check
  check (managed_profile_id is null or role = 'manager') not valid;
