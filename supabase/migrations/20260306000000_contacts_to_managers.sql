-- Drop the contacts table entirely (policies and indexes dropped via CASCADE)
drop table if exists contacts cascade;

-- Add phone to profile_managers (name/email come from the manager's linked profile)
alter table profile_managers
  add column if not exists phone text;

-- Add fields to invitations to support "invite parent of existing player" flow:
--   managed_profile_id: links the invite to an existing player profile
--   relationship: pre-fills the profile_managers row on acceptance
alter table invitations
  add column if not exists managed_profile_id uuid references profiles(id),
  add column if not exists relationship text;
