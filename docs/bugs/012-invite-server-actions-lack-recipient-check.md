# BUG-012 — Web invitation server actions do not verify the recipient

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 12)
**Area:** invites / auth
**Evidence class:** Static — code inspection only
**Last verified:** `5acde1074`, code inspection, 2026-09-04

**Severity note:** an authorization bypass, but it requires possessing another person's pending invitation
ID, so it is P1 under the narrow P0 definition in `README.md`.

## Symptom

An authenticated user holding someone else's pending invitation ID can invoke the acceptance server actions
directly and redeem it. The email check that protects this lives on the page, not in the mutation.

## Reproduction

**Static.** No end-user reproduction recorded.

1. Obtain a pending invitation ID addressed to another person.
2. Signed in as an unrelated account, invoke `acceptInvitationAsSelf` (or `acceptInvitationAsGuardian` /
   `acceptManagerInvitation`) directly as a server action, bypassing the page.

**Expected:** rejected — the caller's email does not match the invitation.
**Actual:** the action fetches the invitation with service-role access, checks only existence and
acceptance, and proceeds.

## Evidence

- Web actions: `apps/web/src/app/actions/invite.ts:23`
- API recipient check (the correct pattern, already implemented): `apps/web/src/app/api/invite/[id]/accept/route.ts:44`

## Product decisions

**Split the authorization repair from the expiry policy.** The missing recipient check is a definite
authorization bug and is ready to fix now. Expiry is **additional product behavior** that this ticket
never specified.

**D9 resolved — user decision, 2026-09-15**, accepting the review's recommendation:

| Question | Decision |
| --- | --- |
| Invitation lifetime | **14 days** |
| Resend semantics | A resend **revokes and replaces** the old invitation, so only the newest link works |
| Expired-link experience | Show a clear **request-a-new-invite** state, not a generic error or a dead end |
| Order of work | Ship the recipient check **first**; expiry follows separately |

**Open residual — existing pending invitations.** The decision is that a grace or reissue policy must
be chosen *before* expiry is enforced, but not what it is. Recommend giving every invitation pending at
deploy time a fresh 14 days from the deploy date, rather than expiring links that were valid when sent.
Needs a yes/no before the expiry work ships; it does not block the recipient check.

## Cause

The page-level email check is not an authorization boundary — exported server actions are directly
invocable. The API route added this check in March (`docs/specs/archive/bug-fixes-and-test-improvements.md`,
Bug 1), but the server actions were not covered by that fix.

## Proposed fix

Centralize normalized recipient checks, role/type validation and atomic one-time acceptance **in the
mutation itself**, shared with the API route rather than duplicated.

Ship this first. The D9 expiry work — 14-day lifetime, revoke-on-resend, request-a-new-invite state — is a
separate change that must not delay the authorization repair.

Shares acceptance boundaries with [BUG-011](./011-identity-differs-web-vs-mobile.md) — design the two
together.

## Regression test

Test **all three** server actions invoked directly: as a non-recipient (denied), and as the legitimate
recipient (permitted).

Validate invitation **type and role**, not only the recipient — a manager invitation must not be redeemable
through the self-acceptance path.

Preserve legitimate retries without creating duplicate records: two acceptances of the same invitation by
the right person must be safe, and concurrent acceptance must resolve to one membership.

For the D9 expiry work, separately: an invitation older than 14 days is rejected; a resend invalidates the
previous link; an expired link renders the request-a-new-invite state rather than an error.
