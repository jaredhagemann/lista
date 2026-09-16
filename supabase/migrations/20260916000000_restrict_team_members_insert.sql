-- BUG-001: restrict direct team_members inserts to team admins.
--
-- The previous policy (20260303000002_managed_profiles.sql) also accepted:
--   • profile_id = auth.uid()      — any user could insert themselves into any
--                                    team at any role, including coach
--   • is_managed_by_me(profile_id) — a guardian could insert a managed child
--                                    into any team and, through is_team_member's
--                                    manager branch, read that team's data
--
-- Legitimate admission paths are unaffected: invitation acceptance and
-- managed-profile creation write through the service role, and the
-- create_team / create_club_team RPCs are SECURITY DEFINER. Team admins —
-- including org owners/directors via is_team_admin — can still add members.

drop policy "Team members managed by admins" on team_members;
create policy "Team members managed by admins"
  on team_members for insert with check (
    is_team_admin(team_id)
  );
