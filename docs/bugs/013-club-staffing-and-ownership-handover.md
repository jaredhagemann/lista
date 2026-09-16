# BUG-013 — Director invite/remove routes are missing and club ownership cannot be handed over

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 13)
**Area:** club / account
**Evidence class:** Static — code inspection only
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Scope

This ticket contains **at least three independently releasable areas**. Do not treat it as one
change:

1. **Missing director routes** — already specified, owner-only, and shippable on its own.
2. **Organization succession** — ownership transfer with recipient acceptance, club closure, admin recovery.
3. **Sole-guardian deletion** — the D1 login invariant, which changes an existing product contract.
   **Delivered by [BUG-002](./fixed/002-profile-managers-claim-child.md) (2026-09-16):** the database refuses to
   remove a player's last guardian with a login, including through account deletion, and
   `/api/account/delete` returns `409 sole_guardian`. `docs/test-plans/account-deletion.md` was reconciled in
   the same PR.

Area 1 should not wait on the D7 policy work in areas 2 and 3.

## Symptom

Club settings shows working-looking **Invite director** and **Remove director** controls that cannot
succeed — the API routes they call do not exist. Separately, an organization owner can delete their account
and leave the club with no owner, and a child's sole guardian can delete theirs and leave the child
unmanaged.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded.

Missing routes:
1. Open club settings as an org owner and invite a director.

**Expected:** the director is invited.
**Actual:** the request 404s — `/api/club/directors/invite` and `/api/club/directors/remove` do not exist.

Ownership gap:
1. As an organization owner, transfer all owned **teams** to another user.
2. Delete the account.

**Expected:** deletion is blocked until organization ownership is transferred.
**Actual:** the deletion gate checks team ownership only; the account is deleted and the organization
membership cascades away, leaving the club with no owner.

## Evidence

- Missing-route callers: `apps/web/src/components/club/club-settings-client.tsx:81`
- Deletion gate: `apps/web/src/app/api/account/delete/route.ts:4`
- Organization membership cascade / one-owner index: `supabase/migrations/20260416000001_organization_members.sql:12`
- Guardian link cascade: `supabase/migrations/20260303000002_managed_profiles.sql:39`

## Cause

Two separate gaps. The director routes were never implemented although their callers shipped. The account
deletion gate predates organizations and checks only team ownership; the "one owner" index guarantees *at
most* one owner, not that an owner continues to exist.

## Product decisions

**Accepted under D1 — September 15, 2026:** every player profile must retain a login path. The last
guardian cannot be removed when the player has no independent login. Account deletion must not silently
bypass that invariant. Reconcile the existing account-deletion test plan with the accepted rule.

**D7 direction accepted — September 15, 2026:** provide explicit organization ownership transfer with
recipient acceptance, a club-closure alternative and a documented administrator-recovery process.
Guardian/account deletion must leave an accepted replacement guardian or the player's independent login;
otherwise resolve that dependency before deletion. Club closure must not delete shared player identities
or guardian relationships used by other clubs.

**D7 resolved — closure accepted September 15, 2026:** archive closed clubs. Their roster, event,
availability and chat history remains read-only for remaining authorized members, preserving
private-group/DM boundaries and revocation rules. Club closure does not automatically erase history.

See [D1 and D7 decision record](../reviews/2026-09-15-bug-backlog-review.md).

## Proposed fix

Finish director provisioning/removal and organization ownership transfer. Block deletion until club and
guardian responsibilities are transferred or explicitly resolved. Document a recovery path for a lost
administrator account.

**Note:** `docs/test-plans/account-deletion.md` exists and should be extended alongside this fix.

## Regression test

Assert deletion is blocked for a sole org owner and a sole guardian, and that director invite/remove
round-trip successfully.

Also cover accepted ownership transfer and club closure: archived history remains readable only within
existing authorization boundaries, operational writes are blocked, revoked members cannot regain access,
and shared player identities/guardian links remain intact.
