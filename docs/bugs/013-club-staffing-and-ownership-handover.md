# BUG-013 — Director invite/remove routes are missing and club ownership cannot be handed over

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 13)
**Area:** club / account

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

## Fix

Finish director provisioning/removal and organization ownership transfer. Block deletion until club and
guardian responsibilities are transferred or explicitly resolved. Document a recovery path for a lost
administrator account.

**Note:** `docs/test-plans/account-deletion.md` exists and should be extended alongside this fix.

## Regression test

Assert deletion is blocked for a sole org owner and a sole guardian, and that director invite/remove
round-trip successfully.
