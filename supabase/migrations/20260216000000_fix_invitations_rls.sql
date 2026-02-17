-- Fix: replace auth.users table reference with auth.jwt() to avoid
-- "permission denied for table users" errors for authenticated users.
drop policy "Invited users can view own invitation" on invitations;

create policy "Invited users can view own invitation"
  on invitations for select using (
    email = (auth.jwt() ->> 'email')
    or accepted_at is null
  );
