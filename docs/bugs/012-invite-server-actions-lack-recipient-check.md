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
authorization bug and is ready to fix now. Expiry is **additional product behavior** that this ticket never
specified — no lifetime, no resend semantics, no transition for existing pending links.

Tracked as **D9** in `docs/reviews/2026-09-15-bug-backlog-review.md`:

| Question | Recommendation | Decision |
| --- | --- | --- |
| Invitation lifetime | 14 days as a starting point — **proposed, not an existing requirement** | **Open** |
| Resend semantics | Resend revokes/replaces the old invitation | **Open** |
| Existing pending invitations | Needs a grace or reissue policy **before** expiry is enforced | **Open** |

Do not enforce expiry as part of the recipient-check fix.

## Cause

The page-level email check is not an authorization boundary — exported server actions are directly
invocable. The API route added this check in March (`docs/specs/archive/bug-fixes-and-test-improvements.md`,
Bug 1), but the server actions were not covered by that fix.

## Proposed fix

Centralize normalized recipient checks, role/type validation and atomic one-time acceptance **in the
mutation itself**, shared with the API route rather than duplicated. Leave expiry out until D9 is settled.

Shares acceptance boundaries with [BUG-011](./011-identity-differs-web-vs-mobile.md) — design the two
together.

## Regression test

Test **all three** server actions invoked directly: as a non-recipient (denied), and as the legitimate
recipient (permitted).

Validate invitation **type and role**, not only the recipient — a manager invitation must not be redeemable
through the self-acceptance path.

Preserve legitimate retries without creating duplicate records: two acceptances of the same invitation by
the right person must be safe, and concurrent acceptance must resolve to one membership.
