alter table invitations
  add column if not exists birthday date,
  add column if not exists gender text;
