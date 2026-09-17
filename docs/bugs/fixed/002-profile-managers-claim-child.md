# BUG-002 — A user can claim another player's profile as their managed child

**Severity:** P0
**Status:** Fixed — reopened findings fixed and verified in production 2026-09-16
**Reported:** 2026-09-04 by readiness review (finding 2)
**Area:** auth / rls / managed profiles
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

## Reopened 2026-09-16

A review of the merged fix (PR #56), `docs/reviews/2026-09-16-bug002-merged-fix-review.md`, reproduced gaps
with probes in `docs/reviews/2026-09-16-bug002-gap-probes.test.ts`. The protections already merged still hold;
these are routes around them.

| Finding | Severity | Status |
| --- | --- | --- |
| **1. A coach can fabricate the team membership that authorizes a staff guardian invitation.** BUG-001 kept `is_team_admin(team_id)` as enough to insert **any** profile into a team. A coach adds someone else's child to their own team, invites themselves as guardian, and accepts — gaining that child's guardianship across every club. `can_invite_guardian_for` and `/api/invitations/send` trust exactly that membership. | P0 | **Fixed** — option A, see Reopened fix as implemented |
| **2. A guardian invitation can be redeemed as a team-role invitation**, making the recipient team staff | P0 | **Closed 2026-09-16 (user) — fixed by [BUG-012](./012-invite-server-actions-lack-recipient-check.md)**: acceptance must match the invitation's kind, and guardian invitations are constrained to role `manager` at creation |
| **3. A player can delete their own Self link**, losing the authority to invite guardians that `can_invite_guardian_for` derives from it, with no way to recreate it now that client inserts are blocked | P2 | **Fixed** — see Reopened fix as implemented |

### Finding 1 — decided: option A

**User decision, 2026-09-16: option A.** Client sessions no longer insert `team_members` rows at all,
including team admins and org directors.

No web or mobile code inserts `team_members` through a user session: every real admission goes through the
service role (invitation acceptance, club director setup) or the team-creation RPCs. No spec plans for staff
to add or move existing players. The capability behind finding 1 is therefore unused.

| Option | Effect |
| --- | --- |
| **A. Remove client-session inserts into `team_members` entirely** (recommended) | A player's membership on a team then always comes from an accepted invitation, team creation, or club setup, so "player on my team" is trustworthy again. Removes a direct-insert ability no app code uses. The RLS tests asserting admins and org directors can insert directly are inverted. |
| B. Keep direct inserts; staff guardian invitations need approval from an existing guardian | Changes D1, which says staff-initiated invitations need only recipient acceptance |
| C. Stop staff sending guardian invitations; only the player or a guardian may | Changes D1 |

### Finding 3 — agreed fix

**User agreed the proposed fix, 2026-09-16.** Shipped in the same PR as finding 1.

Make Self links undeletable except when the profile itself is deleted, and hide their **Remove** action. Derive
the player's authority in `can_invite_guardian_for` and the managers page from the authenticated user owning the
profile (`auth_user_id = auth.uid()`), not from the optional Self row.

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
**PR:** #56
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
  [BUG-012](./012-invite-server-actions-lack-recipient-check.md). Until 012 ships, anyone holding a valid
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

**Deployed 2026-09-16** (merge `e664131b7`, PR #56):
- The production migration job logged `Applying migration 20260917000000_protect_guardian_links.sql...`, and the
  Vercel production deploy succeeded.
- The staging checks passed before merge.
- The production SQL checks passed (user, 2026-09-16): SELECT and DELETE policies only on `profile_managers`, both
  invitations policies present, both triggers present, and `guardian_dependents` not executable by `authenticated`.

---

## Reopened fix as implemented

**Branch:** `fix/002-guardian-authorization-gaps`
**PR:** #58
**Migration:** `supabase/migrations/20260917000002_close_guardian_authorization_gaps.sql`

### Finding 1 — no client-session roster admissions (option A)

- The `team_members` INSERT policy is **dropped with no replacement**. Team admins and org directors can no
  longer add any profile to a team through the data API. Every real admission already went elsewhere:
  invitation acceptance (`accept_invitation`), club setup (`/api/club/teams`, service role) and the
  team-creation RPCs. So a player's membership is again evidence of an accepted invitation, which is what
  `can_invite_guardian_for` and `/api/invitations/send` rely on.
- **A second route to the same fabrication, found while implementing:** the UPDATE policy let an admin change
  **any** column, so re-pointing an existing roster row's `profile_id` or `team_id` would have fabricated a
  membership as surely as an insert. Trigger `team_members_protect_identity` now refuses changes to either
  column from client sessions. App code only ever updates `role`, `jersey_number` and `position`.

This removes the admin-insert branch that [BUG-001](./001-team-members-self-insert-coach.md) deliberately
kept; that ticket carries an addendum.

### Finding 3 — Self links last as long as the profile

- `enforce_guardian_login_path` refuses deleting a Self link while its profile exists, on every path including
  the service role. Deleting the profile still cascades it away.
- `can_invite_guardian_for` recognizes the player by **owning the profile** (`auth_user_id = auth.uid()`) as
  well as by guardianship or staff role, so authority no longer depends on the Self row.
  `/api/invitations/send` does the same.
- `removeProfileManager` refuses Self links for everyone, the player included. `removeManagedProfile` refuses
  the caller's own id with a clear message.
- UI: the managers card never shows **Remove** on a Self row. The roster page recognizes the player by their
  login. The web managed-players page no longer lists your own Self link as a managed player, matching mobile,
  which already excluded it.
- The migration **restores missing Self links** for every account holder (`on conflict do nothing`).

### Verification (reopened fix)

**Tests.** Each new case failed against the schema and code before this fix.

RLS, **9 failed on the prior schema**:

| Test | Before |
| --- | --- |
| `team-members` — admin inserts an existing profile into their team | succeeded |
| `team-members` — org director inserts a member directly | succeeded |
| `team-members` — admin re-points a membership at another profile | succeeded |
| `team-members` — admin moves a membership to another team | succeeded |
| `profile-managers` — team admin adds their own managed profile directly | succeeded |
| `profile-managers` — player deletes their own Self link | succeeded |
| `profile-managers` — service role deletes a Self link while the profile exists | succeeded |
| `invitations` — player with a login but no Self link invites a guardian for themselves | refused (42501) |
| `invitation-acceptance` — coach fabricates membership, invites self as guardian, accepts | fabrication succeeded |

The last one is the review's missing end-to-end regression. It runs the whole sequence (admission, re-point,
invitation) and asserts no guardianship and no access to the child's real team.

The two RLS tests that asserted admins and org directors **can** insert directly were inverted; the review
identified them as encoding the bypass.

Unit, **3 failed on the prior code**:
- `managers-actions` — a player removes their own Self link: succeeded
- `profile-actions` — `removeManagedProfile` on the caller's own id: succeeded
- `single-invite-api` — a player with a login but no Self link invites a guardian for themselves: 403

Guards passing before and after: deleting a profile still removes its Self link; admins can still update
jersey number and position (and role); invitation acceptance, team creation and every existing D1 path still
work.

**Review probes** (`docs/reviews/2026-09-16-bug002-gap-probes.test.ts`) assert the defects exist; **all three now
fail**, each at the attack step:
1. The fabricated roster insert is refused by RLS (`42501`).
2. The coach-role guardian invitation is refused by BUG-012's constraint (`23514`).
3. The Self-link delete is refused by the trigger (`P0001`).

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **323 passed** (previously 315)
- `apps/web` suite: **721 passed** (previously 718)
- Root tenant/billing selection: 218 passed and the 3 unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures
- `tsc --noEmit` and ESLint on changed files: clean; regenerated database types unchanged

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. No INSERT policy remains on team_members
select policyname, cmd from pg_policies where tablename = 'team_members' order by cmd;

-- 2. The membership identity trigger exists
select tgname from pg_trigger where tgname = 'team_members_protect_identity';

-- 3. Every account holder has a Self link after the backfill
select count(*) as missing_self_links
from profiles p
where p.auth_user_id is not null
  and not exists (
    select 1 from profile_managers pm where pm.manager_id = p.id and pm.managed_id = p.id
  );

-- 4. Player authority comes from owning the profile
select prosrc like '%auth_user_id = auth.uid()%' as checks_ownership
from pg_proc where proname = 'can_invite_guardian_for';
```

Expected:
1. No INSERT row.
2. One row.
3. `0`.
4. `true`.

**Reopened fix deployed and verified 2026-09-16** (merge `798494b4c`, PR #58):
- The staging checks passed before merge.
- The production migration job logged `Applying migration 20260917000002_close_guardian_authorization_gaps.sql...`
  and the Vercel production deploy succeeded.
- The production checks passed (user).
