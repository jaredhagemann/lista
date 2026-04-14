-- The "Invited users can view own invitation" policy contained an
-- `accepted_at is null` branch that granted every authenticated user read
-- access to all pending invitations across all teams. The comment implied it
-- was needed for the unauthenticated invite-acceptance flow, but every code
-- path that reads an invitation without a session (api/invite/[id], the web
-- invite page, the mobile invite screen) uses a service-role client that
-- bypasses RLS entirely. The clause was providing no benefit while leaking
-- invitee names, email addresses, roles, and relationship metadata to any
-- signed-in user.
--
-- Fix: replace the policy with one that grants access only to the invitation
-- addressed to the caller's own email address. Team-admin visibility is
-- unchanged (governed by the separate "Invitations visible to team admins"
-- policy).

drop policy if exists "Invited users can view own invitation" on invitations;

create policy "Invited users can view own invitation"
  on invitations for select using (
    email = (auth.jwt() ->> 'email')
  );
