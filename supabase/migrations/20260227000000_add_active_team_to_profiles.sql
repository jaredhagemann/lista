alter table profiles
  add column active_team_id uuid references teams(id) on delete set null;

-- Allow users to update their own active_team_id.
-- The existing update policy covers all columns, but we make it explicit here
-- in case a more restrictive policy is added later.
comment on column profiles.active_team_id is
  'The team currently selected by the user. Used to persist team context across sessions and devices.';
