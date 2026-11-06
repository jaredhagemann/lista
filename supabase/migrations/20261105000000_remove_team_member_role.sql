-- BUG-046: removing a club owner or director from a team only changes their role.
--
-- A person has one team_members row per team, so a director who coaches a team
-- holds a `coach` row there and no `director` row behind it. Deleting that row
-- took the team out of their app, though their directorship still gives them
-- access. Decisions (2026-11-05):
--   - removing an owner's or director's coach, manager, player or parent row
--     turns it into a `director` row, and leaves their chat and availability
--   - a `director` row can't be removed from a team: directors are removed in
--     club settings (remove_org_director)
--
-- removeTeamMember calls this first and deletes the row itself only for
-- 'not_club_admin'. Returns:
--   'kept_as_director'  the row is now `director`
--   'director_row'      the row was already `director`; nothing changed
--   'not_club_admin'    the person isn't an owner or director of this team's club
--   'not_found'         no such row on the team
--
-- The directorship is read FOR SHARE, so remove_org_director, which deletes it
-- first, either waits for this and then deletes the new `director` row, or
-- finishes first and this sees no directorship.

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

  perform 1
  from organization_members om
  join teams t on t.organization_id = om.organization_id
  where t.id = p_team_id
    and om.profile_id = v_profile
    and om.role in ('owner', 'director')
  for share of om;
  if not found then
    return 'not_club_admin';
  end if;

  update team_members set role = 'director' where id = p_member_id;
  return 'kept_as_director';
end;
$$;

revoke execute on function remove_team_member_role(uuid, uuid) from public, anon;
grant execute on function remove_team_member_role(uuid, uuid) to authenticated;
