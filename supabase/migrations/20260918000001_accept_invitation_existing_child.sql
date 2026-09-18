-- BUG-011: accepting an invitation created the wrong player identity.
--
-- Guardian acceptance always minted a fresh player profile, so a child invited
-- to a second team became two people who happened to share a name. There was no
-- way to say "this invitation is for a child I already manage".
--
-- accept_invitation now takes an optional p_managed_profile_id. When given, the
-- invitation joins that existing child to the team instead of creating anyone.
-- The caller must already manage the profile: this is the guardian's explicit
-- selection, never a match on name or birthday (decision D6).
--
-- The native app's half of this bug — it offered no player-versus-guardian
-- choice and sent 'self' for every invitation — is fixed in the app and in
-- POST /api/invite/[id]/accept, which previously refused 'guardian' outright.

drop function if exists accept_invitation(uuid, uuid, text, text, text, text);

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

revoke execute on function accept_invitation(uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
