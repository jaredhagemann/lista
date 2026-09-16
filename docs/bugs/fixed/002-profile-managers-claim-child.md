# BUG-002 — A user can claim another player's profile as their managed child

**Severity:** P0
**Status:** Open
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
[BUG-001](./fixed/001-team-members-self-insert-coach.md) — fixing team self-insertion does not close it.

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
[BUG-013](./013-club-staffing-and-ownership-handover.md) and D7.

Player-initiated operations must be authenticated as that player; a staff member viewing a child's profile
does not thereby acquire the player's removal permission.

## Regression test

Grants: outsider claiming an existing child (denied); each D1-authorized inviter (permitted); acceptance
establishing access across two clubs.

Revocations: staff-only actor attempting removal (denied); player and existing guardian (permitted);
last-guardian removal with no independent login (denied); the same with a *pending* invitation (still
denied); two guardians removing concurrently (the invariant must hold).
