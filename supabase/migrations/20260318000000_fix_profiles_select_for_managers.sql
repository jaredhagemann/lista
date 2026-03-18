-- The original "Users can view profiles of teammates" policy used a direct
-- team_members join to check if the viewer is a teammate. This breaks for
-- profile-only managers (parents who manage an existing player's profile):
-- they have no team_members row of their own, so the join returns nothing and
-- they cannot read ANY team member profile.
--
-- Replace the policy with one that uses is_team_member(), which already
-- handles both direct membership AND access via profile_managers.

drop policy if exists "Users can view profiles of teammates" on profiles;

create policy "Users can view profiles of teammates"
  on profiles for select using (
    -- Own profile
    id = auth.uid()
    -- Any profile that belongs to a team where auth.uid() is a member
    -- (is_team_member checks both direct team_members rows AND profile_managers)
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
  );
