# BUG-019 — Invitations never expire, and a resend leaves the old link working

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-16, split out of [BUG-012](./fixed/012-invite-server-actions-lack-recipient-check.md)
**Area:** invites
**Evidence class:** Static — code inspection only
**Last verified:** `e664131b7`, code inspection, 2026-09-16

## Symptom

A pending invitation stays redeemable indefinitely. Resending an invitation re-sends the same link rather than
replacing it, so a link from months ago still works. There is no expired-link state to tell a recipient to ask for
a new invite.

## Reproduction

**Static.** No expiry timestamp is stored or checked on any acceptance path.

1. Create an invitation and leave it pending for any length of time.
2. Accept it.

**Expected:** after 14 days the link is refused with a request-a-new-invite state.
**Actual:** it is accepted.

## Evidence

- Acceptance, now centralized in the `accept_invitation` function:
  `supabase/migrations/20260917000001_accept_invitation.sql` (no expiry check)
- Resend route: `apps/web/src/app/api/invitations/[id]/resend/route.ts` — re-sends the same invitation id and only updates `email_status`

## Product decisions

**D9 resolved — user decision, 2026-09-15**, recorded originally on BUG-012:

| Question | Decision |
| --- | --- |
| Invitation lifetime | **14 days** |
| Resend semantics | A resend **revokes and replaces** the old invitation, so only the newest link works |
| Expired-link experience | Show a clear **request-a-new-invite** state, not a generic error or a dead end |
| Order of work | Ship BUG-012's recipient check **first**; expiry follows separately |

**Grace policy — accepted, user decision 2026-09-15.** Every invitation pending at deploy time gets a fresh
14 days from the deploy date. Links that were valid when sent are not killed by the rollout. Expiry is
measured from that reissue point, not from the original send.

## Cause

Invitations have no expiry column and acceptance never compared against one. Resend re-sends the existing
invitation id rather than issuing a replacement.

## Proposed fix

Add an expiry timestamp and enforce it inside `accept_invitation`, alongside the existing recipient, kind and
one-time checks, so every acceptance path gets it at once. Backfill pending invitations to deploy time plus 14
days. Make resend create a replacement and revoke the previous invitation. Render the request-a-new-invite
state on web and mobile.

## Regression test

- an invitation older than 14 days is refused on every acceptance path (web self, web guardian, web manager, API route)
- a resend invalidates the previous link, and the new one works
- an expired link renders the request-a-new-invite state rather than an error
- an invitation pending at deploy time stays valid for 14 days from deploy, not from its original send date
