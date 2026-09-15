# BUG-001 — An authenticated user can grant themselves coach access to any team

**Severity:** P0
**Status:** Open
**Reported:** 2026-09-04 by readiness review (`docs/reviews/2026-09-04-teamsnap-one-readiness-report.md`, finding 1)
**Area:** auth / rls

## Symptom

Knowing only a team's UUID, any authenticated user — including someone from an unrelated organization —
can insert themselves into that team as `coach` and gain admin rights over its data, roster and events.
No invitation is required.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an authenticated user with no membership in the target team.
2. Confirm the user sees zero teams.
3. `INSERT INTO team_members (team_id, profile_id, role) VALUES ('<known team uuid>', auth.uid(), 'coach')`.
4. Query `is_team_admin('<team uuid>')`.

**Expected:** the insert is rejected — membership and role come from an accepted invitation.
**Actual:** the insert succeeds and `is_team_admin` returns `true`.

**Environment:** local (probe); the policy is the same in all environments.

## Evidence

- Membership policy: `supabase/migrations/20260303000002_managed_profiles.sql:158`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`
- **The current test suite asserts that self-insertion succeeds** (as `player`, at line 54): `tests/rls/team-members.test.ts:54`

## Cause

The `team_members` INSERT policy accepts any row where `profile_id = auth.uid()`, without checking
invitation acceptance and without restricting which `role` may be inserted. Hiding join controls in the UI
does not protect direct PostgREST requests.

The passing RLS suite does not catch this because it encodes the current behavior as the expectation.

## Fix

Make admission and role assignment an authorized, atomic server/database operation; remove unrestricted
self-insertion. Legitimate team creation must keep working through the existing privileged RPCs.

## Regression test

Must include hostile direct-API tests: an uninvited user across organizations attempting self-insertion at
each role. Note that the `"user can self-insert as team member"` test asserts the buggy behavior and has to be inverted
as part of the fix.
