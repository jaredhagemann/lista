# BUG-002 — A user can claim another player's profile as their managed child

**Severity:** P0
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 2)
**Area:** auth / rls / managed profiles

## Symptom

Any authenticated user can attach themselves as the manager of an arbitrary existing player profile, then
edit that player's details and reach the teams the player belongs to. Roster identity and availability for
a child can end up controlled by an unrelated account.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an outsider with no relationship to the target child profile.
2. `INSERT INTO profile_managers (manager_id, managed_id) VALUES (auth.uid(), '<child profile uuid>')`.
3. Update the child's `full_name`.
4. Read the child's team.

**Expected:** establishing management requires a verified invitation or an authorized guardian/admin action.
**Actual:** all three steps succeed.

**Environment:** local (probe); policy identical in all environments.

## Evidence

- Manager INSERT policy: `supabase/migrations/20260303000002_managed_profiles.sql:92`
- Profile UPDATE policy: `supabase/migrations/20260303000002_managed_profiles.sql:108`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Cause

`profile_managers` permits INSERT whenever `manager_id = auth.uid()`, with no proof that the caller is
authorized to manage `managed_id`. This is an independent path from [[001]] — fixing team self-insertion
does not close it.

## Fix

Require a verified invitation or an authorized guardian/admin operation to establish management. Protect
identity/auth linkage fields separately from editable profile details.

## Regression test

Cover: outsider claiming an existing child, guardian revocation, and cross-club access after a claim.
