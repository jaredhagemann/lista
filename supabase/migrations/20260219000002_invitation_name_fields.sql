-- Add optional name fields to invitations so admins can label who they're inviting
alter table invitations add column first_name text;
alter table invitations add column last_name text;
