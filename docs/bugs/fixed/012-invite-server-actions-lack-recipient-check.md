# BUG-012 — Web invitation server actions do not verify the recipient

**Severity:** P1
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 12)
**Area:** invites / auth
**Evidence class:** Reproduced (local stack, real actions and route) — **unverified in deployment**
**Last verified:** `e664131b7` + this branch, local stack, 2026-09-16

**Severity note:** an authorization bypass, but it requires possessing another person's pending invitation
ID, so it is P1 under the narrow P0 definition in `README.md`. The invitation-kind defect found while fixing it
(below) needs no stolen ID; the 2026-09-16 review of BUG-002 graded that part P0.

## Symptom

An authenticated user holding someone else's pending invitation ID can invoke the acceptance server actions
directly and redeem it. The email check that protects this lives on the page, not in the mutation.

## Reproduction

**Reproduced 2026-09-16** by `tests/rls/invitation-acceptance.test.ts`, which calls the real server actions and
route against a local stack. Only the cookie session and Next.js request helpers are mocked.

1. Obtain a pending invitation ID addressed to another person.
2. Signed in as an unrelated account, invoke `acceptInvitationAsSelf` (or `acceptInvitationAsGuardian` /
   `acceptManagerInvitation`) directly as a server action, bypassing the page.

**Expected:** rejected — the caller's email does not match the invitation.
**Actual:** the action fetches the invitation with service-role access, checks only existence and
acceptance, and proceeds.

## Evidence

- Web actions: `apps/web/src/app/actions/invite.ts:23`
- API recipient check (the correct pattern, already implemented): `apps/web/src/app/api/invite/[id]/accept/route.ts:44`
- Review of the merged BUG-002 fix, finding 2: `docs/reviews/2026-09-16-bug002-merged-fix-review.md`

## Product decisions

The ticket originally carried D9, invitation expiry. The ticket itself said the recipient check ships first and
expiry follows as a separate change, so **expiry moved to its own ticket on 2026-09-16:
[BUG-019](../019-invitations-never-expire.md)**, with the D9 decisions and grace policy.

## Cause

The page-level email check is not an authorization boundary — exported server actions are directly
invocable. The API route added this check in March (`docs/specs/archive/bug-fixes-and-test-improvements.md`,
Bug 1), but the server actions were not covered by that fix.

**Two further defects on the same paths, found while fixing this (2026-09-16):**

- **Nothing tied the acceptance path to the invitation's kind.** A guardian invitation (`managed_profile_id`
  set) is stored with role `manager`, the same string as the team manager staff role. Accepting one "as self" —
  through `acceptInvitationAsSelf` or `POST /api/invite/[id]/accept` with `type: "self"` — inserted a
  `team_members` row with role `manager`, making the recipient **team staff**. The API route's email check did
  not help, because the recipient really was the invited person. Since guardians may create guardian
  invitations, and nothing constrained their role or team, a parent could address one to themselves with
  role `coach` for any team and become that team's admin. This is **finding 2** of the BUG-002 review. The
  guardian path also accepted coach and guardian invitations.
- **Acceptance was check-then-write.** `accepted_at` was read first and written last, so concurrent
  acceptances all succeeded. On the guardian path that created duplicate players.

---

## Fix as implemented

**Branch:** `fix/012-invite-recipient-check`
**PR:** #57
**Migration:** `supabase/migrations/20260917000001_accept_invitation.sql`

**One acceptance operation for every entry point.** The new `accept_invitation` database function
(service-role only) does everything in one transaction:
1. Locks the invitation row, so concurrent acceptances serialize and only the first succeeds.
2. Checks the recipient against the authenticated user's `auth.users` email, trimmed and case-insensitive.
3. Checks that the mode matches the invitation's kind.
4. Performs every write and sets `accepted_at`.

The three web actions and the API route call it through `apps/web/src/lib/invitations/accept.ts`, which maps
its errors to each caller's existing messages and HTTP statuses (404, 410, 403 `Forbidden`, 400
`Invalid invitation type`).

| Invitation kind | Allowed acceptance |
| --- | --- |
| Guardian invitation (`managed_profile_id` set) | `manager` only — link to that existing player |
| Player invitation | `self` (join as the player) or `guardian` (create the player, link as guardian) |
| Coach / manager invitation | `self` only |

**Creation side too.** A check constraint `invitations_guardian_role_check` requires a guardian invitation's
role to be `manager` for every writer, service role included. `/api/invitations/send` returns 400 first, with a
clear message. The constraint is `NOT VALID`, so it applies to new and updated rows without failing on any
existing row; `accept_invitation` refuses to redeem such a row as a team role regardless.

**Also:** the invite page compares emails case-insensitively, matching the database, so an invitation addressed
to `Jane@…` no longer sends a signed-in `jane@…` to the wrong-email screen.

**Not addressed here:**
- Expiry → [BUG-019](../019-invitations-never-expire.md).
- Mobile still accepts every non-guardian invitation as `self`, including when a parent accepts a player
  invitation → [BUG-011](../011-identity-differs-web-vs-mobile.md). The acceptance function is where 011's
  identity-aware flow should extend.
- BUG-002 review findings 1 and 3 remain open; see [BUG-002](./002-profile-managers-claim-child.md).

## Verification

**Integration tests** — `tests/rls/invitation-acceptance.test.ts` (real actions and route, local stack).
**8 failed against the unfixed code**, each because a refused operation succeeded:

| Test | Unfixed |
| --- | --- |
| `acceptInvitationAsSelf` — someone else's invitation | accepted |
| `acceptInvitationAsGuardian` — someone else's invitation | accepted |
| `acceptManagerInvitation` — someone else's guardian invitation | accepted |
| `acceptInvitationAsSelf` — guardian invitation | recipient became team `manager` |
| API route `type: "self"` — guardian invitation | 200, recipient became team `manager` |
| `acceptInvitationAsGuardian` — coach invitation | accepted |
| `acceptInvitationAsGuardian` — guardian invitation | accepted |
| concurrent guardian acceptance | both succeeded — two players |

Guards passing before and after:
- the route refuses a non-recipient (403)
- emails compare case-insensitively
- `acceptManagerInvitation` and the route refuse a plain invitation (400)
- a second acceptance is refused
- all four legitimate acceptances still work

A new case confirms client sessions cannot call `accept_invitation` directly with another user's id.

Creation-side tests failed against the unfixed code: `tests/rls/invitations.test.ts` — a guardian, and the
service role, creating a guardian invitation with a team role (both succeeded); and
`apps/web/tests/single-invite-api.test.ts` — the send route accepting role `coach` on a guardian invitation (200).

**Review probes** (`docs/reviews/2026-09-16-bug002-gap-probes.test.ts`) assert the defects exist, so a failing
probe means that defect is fixed. On this branch, **probe 2 (guardian invite redeemed as coach) now fails
with 400**. Probes 1 and 3 still pass; those findings belong to BUG-002.

The concurrent test fires both acceptances in parallel and asserts the outcome; the row lock is what
guarantees it under true overlap.

`tests/api-auth.test.ts` now mocks the function for its "missing invite → 404" case. `vitest.config.rls.mts`
aliases `next/cache` and `next/headers`, as it already did `next/server`, so root tests can mock them for the
server actions.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **315 passed** (previously 295)
- `apps/web` suite: **718 passed** (previously 717)
- Root tenant/billing selection: 218 passed and the 3 unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures
- `tsc --noEmit` and ESLint on changed files: clean

`src/types/database.ts` was regenerated; the diff is only the new function.

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. The function exists and client roles cannot execute it
select has_function_privilege('authenticated', 'accept_invitation(uuid, uuid, text, text, text, text)', 'execute')
  as authenticated_can_execute;

-- 2. The creation-side constraint exists (NOT VALID, so convalidated = false)
select conname, convalidated from pg_constraint where conname = 'invitations_guardian_role_check';

-- 3. Informational: existing guardian invitations carrying a team role
select count(*) from invitations where managed_profile_id is not null and role <> 'manager';
```

Expected: `false`; one row with `convalidated = false`. For query 3, zero means the constraint can later be
validated with `alter table invitations validate constraint invitations_guardian_role_check`. Anything else
means rows were written that way, and each should be reviewed.

**Staging checks passed** (user, 2026-09-16, PR #57 before merge):
1. `authenticated_can_execute` = `false`.
2. `invitations_guardian_role_check` exists with `convalidated = false`.
3. **Zero** guardian invitations carry a team role, so the constraint can be validated
   (`alter table invitations validate constraint invitations_guardian_role_check`). Run query 3 in production
   after deploy before doing so; a zero on staging says nothing about production rows.

**Deployed and verified 2026-09-16** (merge `d1cd964b6`, PR #57): the production migration job logged
`Applying migration 20260917000001_accept_invitation.sql...`, the Vercel production deploy succeeded, and the
production checks passed (user). The function is not executable by `authenticated`, the constraint exists and is
not yet validated, and zero guardian invitations carry a team role, so
`alter table invitations validate constraint invitations_guardian_role_check` is safe to run when convenient.
