# BUG-002 — A user can claim another player's profile as their managed child

**Severity:** P0
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 2)
**Area:** auth / rls / managed profiles
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

## Symptom

Any authenticated user can attach themselves as the manager of an arbitrary existing player profile, then
edit that player's details and reach the teams the player belongs to. Roster identity and availability for
a child can end up controlled by an unrelated account.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an outsider with no relationship to the target child profile.
2. `INSERT INTO profile_managers (manager_id, managed_id) VALUES (auth.uid(), '<child profile uuid>')`.
3. `UPDATE profiles SET first_name = '<new name>' WHERE id = '<child profile uuid>'`.
4. Read the child's team.

**Expected:** establishing management requires an authorized path — see the Product decisions table.
**Actual:** all three steps succeed.

**Deployment status:** reproduced locally against the checked-in migrations. **Production behavior has not
been checked.**

## Evidence

- Manager INSERT policy: `supabase/migrations/20260303000002_managed_profiles.sql:92`
- Profile UPDATE policy: `supabase/migrations/20260303000002_managed_profiles.sql:108`
- Probe: `docs/reviews/2026-09-04-local-readiness-probes.sql` (updates `first_name`)
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Product decisions

Settled as **D1** in `docs/reviews/2026-09-15-bug-backlog-review.md`.

| Question | Decision | Date |
| --- | --- | --- |
| Who may invite another guardian? | The player, their coach/director/manager, or an existing guardian | 2026-09-15 |
| Who may remove a guardian? | The player or an existing guardian. **A staff role alone does not grant removal.** | 2026-09-15 |
| Does a cross-club invitation need extra approval? | No — recipient acceptance establishes the global relationship across the child's teams/clubs, including for staff-initiated invitations | 2026-09-15 |
| May the last guardian be removed? | No, not while the player has no independent login. Every player profile must retain a login path. A *pending* invitation does not supply one — the replacement must have accepted and be linked. | 2026-09-15 |

A parent's ability to create a fresh child profile is preserved. Arbitrary self-claims of existing profiles
remain forbidden.

## Cause

`profile_managers` permits INSERT whenever `manager_id = auth.uid()`, with no proof that the caller is
authorized to manage `managed_id`. This is an independent path from
[BUG-001](./001-team-members-self-insert-coach.md) — fixing team self-insertion does not close it.

**Revocation has the mirror-image flaw.** `removeProfileManager` (`apps/web/src/app/actions/managers.ts:20`)
lets any coach/manager/director sharing **any** team with the child delete the global guardian link. For a
child in two clubs, a coach at club A can sever the parent's relationship used to access club B. This is a
static finding, not a live reproduction, and it contradicts the D1 decision above.

**A third path, found while fixing BUG-001 (static, 2026-09-16).** The `createManagedProfile` server action
(`apps/web/src/app/actions/profile.ts`) takes `managerId` from the caller and inserts the
`profile_managers` link through the **service role**, so RLS never sees it. Any signed-in user can create a
managed profile and attach **someone else** as its manager. The only caller passes the signed-in user's own
id, but server actions are callable directly. The mobile equivalent (`/api/managed-profiles`) derives the
manager from the authenticated user and is not affected. BUG-001 removed this action's team-admission
inputs but left `managerId` for this ticket.

## Proposed fix

Require an authorized path per D1 to establish management, and restrict revocation to the player or an
existing guardian. Protect identity/auth linkage fields separately from editable profile details.

Enforce the last-login invariant **atomically**, including concurrent removal attempts by two different
guardians. Account deletion must not silently bypass it — see
[BUG-013](../013-club-staffing-and-ownership-handover.md) and D7.

Player-initiated operations must be authenticated as that player; a staff member viewing a child's profile
does not thereby acquire the player's removal permission.

## Regression test

Grants: outsider claiming an existing child (denied); each D1-authorized inviter (permitted); acceptance
establishing access across two clubs.

Revocations: staff-only actor attempting removal (denied); player and existing guardian (permitted);
last-guardian removal with no independent login (denied); the same with a *pending* invitation (still
denied); two guardians removing concurrently (the invariant must hold).

---

## Fix as implemented

**Branch:** `fix/002-profile-managers-claim-child`
**PR:** see branch
**Migration:** `supabase/migrations/20260917000000_protect_guardian_links.sql`

**Scope was much wider than filed.** Mapping every place a guardian link is created, removed or used turned
up eight problems. The filed bug was one of them.

### Becoming a guardian without authorization

| # | Path | Fix |
| --- | --- | --- |
| 1 | **Direct insert** into `profile_managers` naming yourself manager of any profile, child or adult (the filed bug) | Client-session INSERT policy removed. No legitimate path used it: links come from the signup trigger (Self rows) and service-role routes. |
| 2 | **`createManagedProfile` took `managerId` from the caller**, attaching someone else as guardian | The guardian is always the signed-in user; the parameter is gone, and the settings form no longer sends it. |
| 3 | **`createManagedProfile` auto-linked any existing account whose email matched** as a second guardian, without acceptance | Removed, per user decision 2026-09-16 (contradicts D1). |
| 4 | **Guardian invitations from staff of any team.** Staff checks only confirmed admin of the *invitation's* team. Anyone can create a team, then invite themselves as guardian of any player and accept. | Staff must administer a team the player is on: enforced in `/api/invitations/send` and in RLS. Both permissive INSERT policies on `invitations` were replaced, since they OR together, and the UPDATE policy gained a `WITH CHECK` so an admin can't re-point an existing invitation at another player. |

### Removing guardians against D1

| # | Path | Fix |
| --- | --- | --- |
| 5 | `removeProfileManager` let **any coach sharing a team** remove a guardian, and refused the other guardian and the player | Now: the guardian themselves, another guardian of the same player, or the player. Staff alone: refused. A player's own Self link can only be removed by that player. The managers card shows **Remove** only to the player or a guardian. |
| 6 | Nothing stopped the **last guardian** of a player with no login from unlinking | Trigger `profile_managers_keep_login_path` refuses it on every delete path, service role included. It locks the player row, so concurrent removals serialize. A pending invitation does not count as a replacement. Deleting the player's own profile still cascades. |
| 7 | **Account deletion** by a sole guardian orphaned the child | The trigger refuses the cascade. `/api/account/delete` checks first via `guardian_dependents` (service role only) and returns `409 sole_guardian` with the affected players' names. Web and mobile explain it and link to Managed Players. Included here per user decision 2026-09-16; this covers the sole-guardian area of [BUG-013](../013-club-staffing-and-ownership-handover.md). |

Both refusal paths (5 and 6) show one clear message rather than the raw database error.

### Editing identity fields

| # | Path | Fix |
| --- | --- | --- |
| 8 | A guardian, or anyone who claimed a profile via #1, could change that profile's `email` and `auth_user_id`, including detaching a teen's login | Trigger `profiles_protect_identity` refuses changes to `id`, `auth_user_id` or `email` from `authenticated`/`anon` sessions. No app code writes those columns through a user session; the web and mobile profile forms edit only name, birthday and gender. |

### Deliberately left alone

- **`acceptManagerInvitation`** (web) still has no recipient-email check. It is exactly the scope of
  [BUG-012](../012-invite-server-actions-lack-recipient-check.md). Until 012 ships, anyone holding a valid
  guardian invitation's ID can accept it. After this fix, such an invitation can only have come from the
  player, a guardian, or the player's own staff.
- **`updateProfileManager`** still lets staff sharing a team edit a guardian's relationship label and phone.
  D1 covers adding and removing guardians, not editing contact details.

## Verification

**Tests.** Each new hostile case failed against the unfixed code or schema, for the expected reason.

RLS (`tests/rls/profile-managers.test.ts`, `tests/rls/invitations.test.ts`). **12 failed on the unfixed schema:**

| Test | Unfixed |
| --- | --- |
| outsider claims an existing child, then edits them | insert succeeded |
| outsider claims another adult's account profile | insert succeeded |
| guardian changes a child's email | update succeeded |
| guardian detaches a teen's `auth_user_id` | update succeeded |
| user changes their own profile email | update succeeded |
| sole guardian unlinks a child with no login | delete succeeded |
| …same, with a pending guardian invitation outstanding | delete succeeded |
| both guardians remove concurrently (service role) | both succeeded |
| sole guardian's account is deleted | deletion succeeded |
| `guardian_dependents` lists only at-risk players | function did not exist |
| coach of an unrelated team invites a guardian for another team's player | insert succeeded |
| coach re-points an existing invitation at an outside player | update succeeded |

Guards passing before and after: a guardian may still edit a child's name, birthday and gender. A guardian
may unlink when another guardian with a login remains, or when the player has their own login. Deleting the
child's own profile still removes its links. `guardian_dependents` is not callable from a client session.
Invitations: a coach for a player on their team, an existing guardian, and a player for themselves may all
invite.

The concurrent-removal test fires both deletes in parallel. It asserts the outcome (exactly one succeeds, one
guardian remains) rather than forcing a particular interleaving; the row lock is what makes that outcome
hold under true concurrency.

Unit (`apps/web/tests`). **11 failed on the unfixed code:**

| Test | Unfixed |
| --- | --- |
| `managers-actions` — coach sharing a team removes a guardian | allowed |
| `managers-actions` — another guardian removes a guardian | refused |
| `managers-actions` — player with a login removes their guardian | refused |
| `managers-actions` — last-guardian refusal is explained | raw DB error |
| `profile-actions` — caller-supplied `managerId` | `someone-else` linked |
| `profile-actions` — email match auto-links an existing account | second guardian linked |
| `profile-actions` — `removeManagedProfile` explains last-guardian refusal | raw DB error |
| `account-delete-route` — GET reports sole guardian | 200 eligible |
| `account-delete-route` — DELETE refuses sole guardian | user deleted |
| `account-delete-route` — dependents check errors | user deleted |
| `single-invite-api` — admin invites guardian for a player not on the team | 200 |

`tests/api-auth.test.ts` gained an `rpc` mock returning no dependents, since the account-deletion route now
calls it. That test is about Bearer-token acceptance.

**Full runs** on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **295 passed** (previously 275)
- `apps/web` suite: **717 passed** (previously 697)
- Root tenant/billing selection: 218 passed, 3 failed — the unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures
- `tsc --noEmit`: web and mobile clean. ESLint on changed files: clean apart from a pre-existing `<img>` warning in `roster-profile.tsx`.

`src/types/database.ts` was regenerated; the diff is only the two new functions.

**Before merge, on staging — and after deploy, in production** (read-only SQL editor):

```sql
-- 1. No INSERT policy remains on profile_managers
select policyname, cmd from pg_policies where tablename = 'profile_managers' order by cmd;

-- 2. Invitations: one INSERT policy and the UPDATE policy with a WITH CHECK
select policyname, cmd, with_check from pg_policies
where tablename = 'invitations' and cmd in ('INSERT', 'UPDATE');

-- 3. Both triggers exist
select tgname from pg_trigger
where tgname in ('profile_managers_keep_login_path', 'profiles_protect_identity');

-- 4. guardian_dependents is not executable by client roles
select has_function_privilege('authenticated', 'guardian_dependents(uuid)', 'execute') as authenticated_can_execute;
```

Expected:
1. SELECT and DELETE policies only.
2. `Invitations created by team admins or guardians` (INSERT) and `Invitations updated by team admins` (UPDATE, with a non-null `with_check`).
3. Both trigger names.
4. `false`.
