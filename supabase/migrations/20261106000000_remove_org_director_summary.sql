-- BUG-047: removing a director says what it did.
--
-- The club settings page now confirms before removing a director, then shows
-- what happened. remove_org_director returns it, from the same transaction, so
-- the owner sees what was actually done rather than what the page read before:
--
--   {
--     "teams_passed": ["12U Girls", ...],      -- the director's teams, now the owner's
--     "director_places_removed": 6,            -- their director rows deleted
--     "roles_kept": [{"team": "12U Girls", "role": "coach"}, ...]
--   }                                          -- other roles on this club's teams
--
-- Otherwise as in 20260924000002_club_review_fixes.sql. A function's return
-- type can't be changed in place, so it's dropped and created again, with the
-- same grants: no client role may run it.

drop function remove_org_director(uuid, uuid, uuid);

create function remove_org_director(
  p_actor_id uuid,
  p_org_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_teams_passed jsonb;
  v_places_removed integer;
  v_roles_kept jsonb;
begin
  select profile_id into v_owner
  from organization_members
  where organization_id = p_org_id and role = 'owner'
  for update;
  if v_owner is null or v_owner <> p_actor_id then
    raise exception 'NOT_AUTHORIZED: only the club owner can remove directors' using errcode = '42501';
  end if;

  perform set_config('lista.club_admin', 'on', true);

  -- Only a director: the owner leaves only by transferring ownership.
  delete from organization_members
  where organization_id = p_org_id and profile_id = p_profile_id and role = 'director';
  if not found then
    raise exception 'NOT_A_DIRECTOR' using errcode = 'P0002';
  end if;

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where organization_id = p_org_id and to_profile_id = p_profile_id and status = 'pending';

  -- Their teams pass to the owner.
  with passed as (
    update teams set owner_id = v_owner
    where organization_id = p_org_id and owner_id = p_profile_id
    returning name
  )
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) into v_teams_passed from passed;

  -- The places the directorship gave them; any other role stays.
  delete from team_members tm
  using teams t
  where tm.team_id = t.id
    and t.organization_id = p_org_id
    and tm.profile_id = p_profile_id
    and tm.role = 'director';
  get diagnostics v_places_removed = row_count;

  select coalesce(jsonb_agg(jsonb_build_object('team', t.name, 'role', tm.role) order by t.name), '[]'::jsonb)
  into v_roles_kept
  from team_members tm
  join teams t on t.id = tm.team_id
  where t.organization_id = p_org_id
    and tm.profile_id = p_profile_id;

  -- An active team they can no longer reach would strand them on it.
  update profiles p
  set active_team_id = null
  where p.id = p_profile_id
    and p.active_team_id in (select id from teams where organization_id = p_org_id)
    and not exists (
      select 1 from team_members tm
      where tm.team_id = p.active_team_id and tm.profile_id = p_profile_id
    );

  return jsonb_build_object(
    'teams_passed', v_teams_passed,
    'director_places_removed', v_places_removed,
    'roles_kept', v_roles_kept
  );
end;
$$;

revoke execute on function remove_org_director(uuid, uuid, uuid) from public, anon, authenticated;
