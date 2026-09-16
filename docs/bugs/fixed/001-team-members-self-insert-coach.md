# BUG-001 — An authenticated user can grant themselves coach access to any team

**Severity:** P0
**Status:** Fixed (pending deploy verification — see Verification)
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
[BUG-011](../011-identity-differs-web-vs-mobile.md) and
[BUG-012](../012-invite-server-actions-lack-recipient-check.md).

## Regression test

Hostile: an uninvited user, across organizations, attempting self-insertion at **each** role.

Legitimate (must keep passing): team creation via the privileged RPC, an admin adding a member, and
invitation acceptance.

The `"user can self-insert as team member"` test at `tests/rls/team-members.test.ts:54` asserts the buggy
behavior and must be inverted as part of the fix.

---

## Fix as implemented

**Branch:** `fix/001-team-members-self-insert`
**PR:** #55
**Migration:** `supabase/migrations/20260916000000_restrict_team_members_insert.sql`

**Scope was wider than filed.** The INSERT policy had three branches, and two were open:

```sql
is_team_admin(team_id)             -- kept: an admin adds a member
or profile_id = auth.uid()         -- removed: self-insert at any role (the filed bug)
or is_managed_by_me(profile_id)    -- removed: a guardian adds their managed child to any team
```

The third branch was a second route to the same access. Anyone can create a managed child, so any user could
insert that child into any team and read the team's data through `is_team_member`'s manager branch. This
was **reproduced locally** by the new tests below, not just identified in code.

A **service-role path bypassed the policy entirely.** The `createManagedProfile` server action
(`apps/web/src/app/actions/profile.ts`) accepted a caller-supplied `teamId` and `role` and inserted a
`team_members` row through the service role. Any signed-in user could add a profile they manage to any team at
any role, and no RLS change would have closed that. The inputs are removed. The only caller (the managed
players settings form) never passed them, and the mobile route (`/api/managed-profiles`) never had them.

**Legitimate admission paths are unaffected**, verified by reading each one:

| Path | Why it still works |
| --- | --- |
| Invitation acceptance — web actions and `/api/invite/[id]/accept` | writes through the service role |
| Managed-profile creation — web action and mobile route | writes through the service role; no team admission |
| Club director team setup — `/api/club/teams` | writes through the service role |
| `create_team` / `create_club_team` RPCs | `SECURITY DEFINER`; covered by `tests/rls/create-team-rpc.test.ts` |
| A team admin adding a member, including an org owner/director | the `is_team_admin` branch is retained |

No application code inserts `team_members` through a user-scoped client. The mobile app has no direct inserts.

**Left for other tickets:**
- The same server action also takes `managerId` from the caller, so a caller can make **someone else** a new
  child's guardian. That is a guardian-link problem, recorded on
  [BUG-002](./002-profile-managers-claim-child.md).
- Invitation acceptance checks are [BUG-012](../012-invite-server-actions-lack-recipient-check.md).

## Verification

**Tests.** Each hostile case failed against the unfixed policy with `expected null not to be null`, meaning
the insert succeeded. All pass with the migration applied:

| Test | Unfixed policy | Fixed |
| --- | --- | --- |
| `tests/rls/team-members.test.ts` — uninvited user self-inserts as player / parent / coach / manager / director (also asserts no admin rights and no roster visibility) | insert succeeded ×5 | rejected |
| `tests/rls/team-members.test.ts` — an org owner elsewhere self-inserts into another org's team as coach | insert succeeded | rejected |
| `tests/rls/profile-managers.test.ts` — guardian not on the team adds their managed child | insert succeeded | rejected |
| `tests/rls/profile-managers.test.ts` — guardian who is only a player adds their managed child | insert succeeded | rejected |
| `apps/web/tests/create-managed-profile-action.test.ts` — caller supplies `teamId` + `role: "coach"` | `team_members` insert made | none |

Legitimate paths, passing both before and after: an admin inserts a member; an **org director** inserts a
member into a team in their org (new); a team admin adds their own managed child (renamed from "manager can
add their managed profile to a team they are on," which only ever exercised the admin branch); the action
still creates the profile and manager link; a signed-out caller is rejected.

The test asserting the bug (`"user can self-insert as team member"`) was replaced by the five role cases.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **275 passed** (previously 267)
- `apps/web` suite: **697 passed**
- Root unit, recurrence, tenant and billing selection: 218 passed, 3 failed. These are the
  same three known failures recorded in [BUG-017](../017-stale-test-fixtures-three-failures.md), unchanged.
- `tsc --noEmit` and ESLint on changed files: clean

**After deploy — required.** The migration runs against production on merge. Confirm the new policy in the
production SQL editor (read-only):

```sql
select policyname, with_check
from pg_policies
where tablename = 'team_members' and cmd = 'INSERT';
```

Expected: one policy, `Team members managed by admins`, whose `with_check` is only `is_team_admin(team_id)`.
The same query on **staging** verifies the PR's migration before merge.

**Deployed verification — done 2026-09-16** (merge `44b8c0e6a`, PR #55):
- The staging `pg_policies` check passed before merge.
- The production migration job logged `Applying migration 20260916000000_restrict_team_members_insert.sql...`
  and the Vercel production deploy succeeded.
- The production `pg_policies` check passed: a single INSERT policy, `Team members managed by admins`,
  checking only `is_team_admin(team_id)`.
