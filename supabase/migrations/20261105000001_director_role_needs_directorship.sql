-- BUG-046: only a club owner or director can hold a `director` row on a team.
--
-- The roster's role editor now offers Director for a club owner or director, so
-- a coach can move them between director and a team role (decided 2026-11-05).
-- The access rules let any team admin update a row's role, so without this a
-- director row could be given to anyone through the API.
--
-- Checked when a row becomes `director`, not on every update, so a row that is
-- already `director` can still be edited. Every place that adds director rows
-- (accept_invitation, create_club_team, /api/club/teams, remove_team_member_role)
-- does so for a profile already in organization_members.

create or replace function refuse_director_row_without_directorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'director'
     and (tg_op = 'INSERT' or old.role is distinct from 'director')
     and not exists (
       select 1
       from organization_members om
       join teams t on t.organization_id = om.organization_id
       where t.id = new.team_id
         and om.profile_id = new.profile_id
         and om.role in ('owner', 'director')
     ) then
    raise exception 'NOT_A_CLUB_DIRECTOR: only an owner or director of the club can have the director role on a team'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger team_members_director_needs_directorship
  before insert or update of role on team_members
  for each row execute function refuse_director_row_without_directorship();
