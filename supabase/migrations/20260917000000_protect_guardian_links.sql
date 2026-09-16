-- BUG-002: guardian links (profile_managers) could be created, redirected and
-- removed without authorization. Decisions D1 and D7 in
-- docs/reviews/2026-09-15-bug-backlog-review.md define the intended rules.
--
--   1. Client sessions can no longer insert profile_managers rows. The old
--      policy accepted any row naming the caller as manager, so anyone could
--      claim any profile, child or adult. Legitimate links come from the signup
--      trigger (Self rows) and from server routes using the service role after
--      their own checks.
--   2. A player profile without its own login must keep at least one guardian
--      who has a login. Enforced on every delete path, including service-role
--      deletes and account deletion, and serialized per player so concurrent
--      removals cannot both pass.
--   3. Guardian invitations: team staff may only invite a guardian for a player
--      on their own team. Previously any team admin (and anyone can create a
--      team) could invite for any profile, then accept.
--   4. Client sessions can no longer change a profile's id, auth_user_id or
--      email. A manager could previously rewrite the identity fields of any
--      profile they managed or had claimed.

-- ── 1. No client-session inserts into profile_managers ─────────────────────

drop policy "Managers can add managed profiles" on profile_managers;

-- ── 2. Every player keeps a login path ─────────────────────────────────────

create or replace function enforce_guardian_login_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  player profiles%rowtype;
begin
  -- A Self link (manager = managed) is not a guardian relationship.
  if old.manager_id = old.managed_id then
    return old;
  end if;

  -- Lock the player row so concurrent removals for the same player run one at
  -- a time, each seeing the other's committed result.
  select * into player from profiles where id = old.managed_id for update;

  -- The player profile itself is being deleted (FK cascade): nothing to protect.
  if not found then
    return old;
  end if;

  -- An independent login is a login path on its own.
  if player.auth_user_id is not null then
    return old;
  end if;

  if exists (
    select 1
    from profile_managers pm
    join profiles guardian on guardian.id = pm.manager_id
    where pm.managed_id = old.managed_id
      and pm.id <> old.id
      and pm.manager_id <> pm.managed_id
      and guardian.auth_user_id is not null
  ) then
    return old;
  end if;

  raise exception 'LAST_GUARDIAN: player % must keep at least one guardian with a login', old.managed_id
    using errcode = 'P0001';
end;
$$;

create trigger profile_managers_keep_login_path
  before delete on profile_managers
  for each row execute function enforce_guardian_login_path();

-- Players who would be left without a login path if this manager's account
-- were deleted. Used by the account-deletion route to explain a refusal the
-- trigger above would otherwise raise as a raw error.
create or replace function guardian_dependents(p_manager_id uuid)
returns table (profile_id uuid, first_name text, last_name text)
language sql
stable
security definer
set search_path = public
as $$
  select player.id, player.first_name, player.last_name
  from profile_managers pm
  join profiles player on player.id = pm.managed_id
  where pm.manager_id = p_manager_id
    and pm.managed_id <> p_manager_id
    and player.auth_user_id is null
    and not exists (
      select 1
      from profile_managers other
      join profiles guardian on guardian.id = other.manager_id
      where other.managed_id = pm.managed_id
        and other.manager_id <> p_manager_id
        and other.manager_id <> other.managed_id
        and guardian.auth_user_id is not null
    );
$$;

revoke execute on function guardian_dependents(uuid) from public, anon, authenticated;
grant execute on function guardian_dependents(uuid) to service_role;

-- ── 3. Guardian invitations only for players the inviter is responsible for ─

create or replace function can_invite_guardian_for(p_team_id uuid, p_managed_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The player themselves (via their Self link) or an existing guardian ...
  select is_managed_by_me(p_managed_profile_id)
    -- ... or staff of a team the player is actually on.
    or (
      is_team_admin(p_team_id)
      and exists (
        select 1 from team_members tm
        where tm.team_id = p_team_id
          and tm.profile_id = p_managed_profile_id
      )
    );
$$;

-- Both existing INSERT policies are permissive and OR together, so both go.
drop policy "Invitations created by team admins" on invitations;
drop policy "profile_managers_can_send_invitations" on invitations;

create policy "Invitations created by team admins or guardians"
  on invitations for insert with check (
    case
      when managed_profile_id is null then is_team_admin(team_id)
      else can_invite_guardian_for(team_id, managed_profile_id)
    end
  );

-- Without an explicit WITH CHECK, an admin could re-point an existing
-- invitation at any player.
drop policy "Invitations updated by team admins" on invitations;
create policy "Invitations updated by team admins"
  on invitations for update
  using (is_team_admin(team_id))
  with check (
    is_team_admin(team_id)
    and (
      managed_profile_id is null
      or can_invite_guardian_for(team_id, managed_profile_id)
    )
  );

-- ── 4. Identity fields are not editable from client sessions ───────────────

create or replace function protect_profile_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (
       new.id is distinct from old.id
       or new.auth_user_id is distinct from old.auth_user_id
       or new.email is distinct from old.email
     )
  then
    raise exception 'PROFILE_IDENTITY_LOCKED: id, auth_user_id and email cannot be changed from a client session'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_identity
  before update on profiles
  for each row execute function protect_profile_identity();
