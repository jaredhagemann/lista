-- Fix group creation: the channel creator couldn't see their own channel until
-- they were added as a member, which blocked the channel_members INSERT policy
-- (it subqueries channels for created_by, requiring SELECT access).
-- Adding created_by = auth.uid() breaks that deadlock.

alter policy "channels_select" on channels
  using (
    (type = 'team' and is_team_member(team_id))
    or (type = 'group' and is_channel_member(id))
    or created_by = auth.uid()
  );
