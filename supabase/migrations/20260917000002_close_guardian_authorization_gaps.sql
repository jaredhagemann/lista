-- BUG-002, reopened: findings 1 and 3 of docs/reviews/2026-09-16-bug002-merged-fix-review.md.
-- (Finding 2 was fixed by 20260917000001_accept_invitation.sql, BUG-012.)
--
-- Finding 1 — decision: option A (user, 2026-09-16).
--   Staff may send a guardian invitation for a player on their own team
--   (can_invite_guardian_for). But team admins could insert ANY existing profile
--   into their team, so a coach could put someone else's child on their team,
--   invite themselves as guardian, and gain that child's guardianship across
--   every club. Client sessions can no longer create or re-point memberships.
--   Every real admission already goes through the service role (invitation
--   acceptance, club setup) or the team-creation RPCs, so a player's membership
--   is again evidence of an accepted invitation.
--
-- Finding 3 — agreed fix.
--   A player's Self link (manager = managed) could be deleted, which removed the
--   authority to invite their own guardian that can_invite_guardian_for derived
--   from it. Since client inserts were removed, it could not be recreated. Self
--   links now last as long as the profile, player authority comes from owning
--   the profile, and missing Self links are restored.

-- ── Finding 1: no client-session admissions ───────────────────────────────────

drop policy "Team members managed by admins" on team_members;

-- The UPDATE policy lets admins edit a membership (role, jersey number,
-- position). Without this, re-pointing an existing row at another profile or
-- team would fabricate a membership just as an insert did.
create or replace function protect_team_membership_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (
       new.team_id is distinct from old.team_id
       or new.profile_id is distinct from old.profile_id
     )
  then
    raise exception 'TEAM_MEMBERSHIP_IDENTITY_LOCKED: team_id and profile_id cannot be changed from a client session'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger team_members_protect_identity
  before update on team_members
  for each row execute function protect_team_membership_identity();

-- ── Finding 3: Self links last as long as the profile ─────────────────────────

create or replace function enforce_guardian_login_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  player profiles%rowtype;
begin
  -- A Self link is the account holder's own record, not a guardian relationship.
  -- It may only disappear with the profile itself (FK cascade, where the
  -- profile row is already gone).
  if old.manager_id = old.managed_id then
    if exists (select 1 from profiles where id = old.managed_id) then
      raise exception 'SELF_LINK_REQUIRED: the Self link for % cannot be removed', old.managed_id
        using errcode = 'P0001';
    end if;
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

create or replace function can_invite_guardian_for(p_team_id uuid, p_managed_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The player themselves, identified by owning the profile rather than by the
  -- optional Self link ...
  select exists (
      select 1 from profiles
      where id = p_managed_profile_id
        and auth_user_id = auth.uid()
    )
    -- ... or an existing guardian ...
    or is_managed_by_me(p_managed_profile_id)
    -- ... or staff of a team the player is on. With client-session admissions
    -- removed, that membership came from an accepted invitation.
    or (
      is_team_admin(p_team_id)
      and exists (
        select 1 from team_members tm
        where tm.team_id = p_team_id
          and tm.profile_id = p_managed_profile_id
      )
    );
$$;

-- Restore Self links deleted before they became undeletable.
insert into profile_managers (manager_id, managed_id, relationship)
select id, id, 'Self'
from profiles
where auth_user_id is not null
on conflict (manager_id, managed_id) do nothing;
