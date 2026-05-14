ALTER TABLE invitations
  ADD COLUMN email_status text
  CHECK (email_status IN ('sent', 'failed'))
  DEFAULT 'sent';
