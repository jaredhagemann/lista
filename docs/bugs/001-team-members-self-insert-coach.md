# BUG-001 — An authenticated user can grant themselves coach access to any team

**Severity:** P0
**Status:** Open
**Reported:** 2026-09-04 by readiness review (`docs/reviews/2026-09-04-teamsnap-one-readiness-report.md`, finding 1)
**Area:** auth / rls
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

## Symptom

Knowing only a team's UUID, any authenticated user — including someone from an unrelated organization —
can insert themselves into that team as `coach` and gain admin rights over its data, roster and events.
No invitation is required.

## Reproduction

**Reproduced** via SQL probe against a local stack running the checked-in migrations.

1. Sign in as an authenticated user with no membership in the target team.
2. Confirm the user sees zero teams.
3. `INSERT INTO team_members (team_id, profile_id, role) VALUES ('<known team uuid>', auth.uid(), 'coach')`.
4. Query `is_team_admin('<team uuid>')`.

**Expected:** the insert is rejected. Membership and role must come from an authorized path — an accepted
invitation, a privileged team-creation RPC, or an admin adding a member — never from a self-assigned role
on a direct API call.

**Actual:** the insert succeeds and `is_team_admin` returns `true`.

**Deployment status:** reproduced locally against the checked-in migrations. **Production behavior has not
been checked.**

## Evidence

- Membership policy: `supabase/migrations/20260303000002_managed_profiles.sql:158`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`
- **The current test suite asserts that self-insertion succeeds** (as `player`): the
  `"user can self-insert as team member"` case at `tests/rls/team-members.test.ts:54`

## Cause

The `team_members` INSERT policy accepts any row where `profile_id = auth.uid()`, without checking
invitation acceptance and without restricting which `role` may be inserted. Hiding join controls in the UI
does not protect direct PostgREST requests.

The passing RLS suite does not catch this because it encodes the current behavior as the expectation.

## Proposed fix

Make admission and role assignment an authorized, atomic server/database operation; remove unrestricted
self-insertion.

**Preserve the legitimate paths** — this is the part most likely to break: privileged team creation through
the existing RPCs, an admin adding a member, and invitation acceptance must all keep working. The fix is
not "deny self-insertion"; it is "membership and role come from an authorized operation."

Shares an admission/identity boundary with [BUG-002](./002-profile-managers-claim-child.md),
[BUG-011](./011-identity-differs-web-vs-mobile.md) and
[BUG-012](./012-invite-server-actions-lack-recipient-check.md).

## Regression test

Hostile: an uninvited user, across organizations, attempting self-insertion at **each** role.

Legitimate (must keep passing): team creation via the privileged RPC, an admin adding a member, and
invitation acceptance.

The `"user can self-insert as team member"` test at `tests/rls/team-members.test.ts:54` asserts the buggy
behavior and must be inverted as part of the fix.
