-- Profile-only managers (parents who manage a player's profile but have no team_members
-- row of their own) show as "Unknown" in chat because other team members cannot read
-- their profile via RLS.
--
-- The existing "Users can view profiles of teammates" policy only allows viewing profiles
-- that appear in team_members. A profile-only manager's profile.id is NOT in team_members,
-- so the join in `messages.select("*, profiles!sender_id(*)")` returns null.
--
-- Fix: add a condition that allows viewing a profile if that profile manages at least one
-- team member on a team the viewer is also on.

drop policy if exists "Users can view profiles of teammates" on profiles;

create policy "Users can view profiles of teammates"
  on profiles for select using (
    -- Own profile
    id = auth.uid()
    -- Any profile that is a direct team member on a team the viewer is part of
    -- (is_team_member handles both direct membership and manager→child access)
    or exists (
      select 1 from team_members tm
      where tm.profile_id = profiles.id
        and is_team_member(tm.team_id)
    )
    -- Managers can always read the profiles they directly manage
    or exists (
      select 1 from profile_managers
      where manager_id = auth.uid()
        and managed_id = profiles.id
    )
    -- Profile-only managers: allow viewing their profile if they manage a player
    -- on a team the viewer is also part of (covers chat sender display)
    or exists (
      select 1 from profile_managers pm
      join team_members tm on tm.profile_id = pm.managed_id
      where pm.manager_id = profiles.id
        and is_team_member(tm.team_id)
    )
  );
