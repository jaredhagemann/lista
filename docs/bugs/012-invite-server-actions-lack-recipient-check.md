# BUG-012 — Web invitation server actions do not verify the recipient

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 12)
**Area:** invites / auth

## Symptom

An authenticated user holding someone else's pending invitation ID can invoke the acceptance server actions
directly and redeem it. The email check that protects this lives on the page, not in the mutation.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded.

1. Obtain a pending invitation ID addressed to another person.
2. Signed in as an unrelated account, invoke `acceptInvitationAsSelf` (or `acceptInvitationAsGuardian` /
   `acceptManagerInvitation`) directly as a server action, bypassing the page.

**Expected:** rejected — the caller's email does not match the invitation.
**Actual:** the action fetches the invitation with service-role access, checks only existence and
acceptance, and proceeds.

## Evidence

- Web actions: `apps/web/src/app/actions/invite.ts:23`
- API recipient check (the correct pattern, already implemented): `apps/web/src/app/api/invite/[id]/accept/route.ts:44`

## Cause

The page-level email check is not an authorization boundary — exported server actions are directly
invocable. The API route added this check in March (`docs/specs/archive/bug-fixes-and-test-improvements.md`,
Bug 1), but the server actions were not covered by that fix. Invitation expiry is also not enforced in
these paths.

## Fix

Centralize normalized recipient checks, role/type validation, expiry, revocation and atomic one-time
acceptance **in the mutation itself**, shared with the API route rather than duplicated.

Related: [[011]] reworks the same acceptance flow for identity.

## Regression test

Invoke each server action directly as a non-recipient, as an expired invitation's recipient, and twice
concurrently as the legitimate recipient.
