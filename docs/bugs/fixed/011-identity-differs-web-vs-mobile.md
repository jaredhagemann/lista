# BUG-011 — Invitation acceptance creates the wrong player identity on mobile

**Severity:** P1
**Status:** Fixed — repair verified in production 2026-09-18; native acceptance check pending
**Reported:** 2026-09-04 by readiness review (finding 11)
**Area:** invites / identity / mobile
**Evidence class:** Static — code inspection only. The duplicate identity it predicted was **found and repaired in production** (2026-09-18)
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Symptom

A parent accepting a player invitation in the native app is enrolled **as the player themselves** — the
signed-in parent's profile becomes the roster player, and the child's birthday/gender may be written onto
the parent's account. Separately, accepting a second team's invitation for the same child on web creates a
duplicate child identity rather than a second membership.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded.

1. As a parent, open a player invitation in the native app (not an existing-player manager invite).
2. Accept it.

**Expected:** the app asks whether the recipient is the player or a guardian, as the web screen does.
**Actual:** `self` is selected for every such invite; the API inserts the parent's profile as the player.

Duplicate identity:
1. Accept a player invitation for a child on team A as guardian (web).
2. Accept a second invitation for the **same child** on team B.

**Expected:** the existing child gains a second team membership.
**Actual:** a new player UUID is created — two identities for one child.

## Evidence

- Native acceptance: `apps/mobile/app/invite/[id].tsx:49`
- API self acceptance: `apps/web/src/app/api/invite/[id]/accept/route.ts:78`
- Web guardian creation: `apps/web/src/app/actions/invite.ts:117`

## Cause

The native screen has no player-vs-guardian branch. Web guardian acceptance always mints a new player UUID
with no "select an existing child" path. Concurrent acceptance is not protected by an atomic claim of the
invitation, and no merge/reconciliation workflow exists.

## Product decisions

**D6 resolved for historical repair — September 15, 2026:** the user confirms no duplicate identities
exist and that they are the only mobile-app user. No historical cleanup or merge workflow is required.
This is user-provided context; no production-data inspection has been performed.

Retain the prevention work: distinguish player versus guardian acceptance on mobile, offer an explicit
selection among already-managed children, and make concurrent/repeated acceptance safe. Do not match
identities automatically by name or birthday.

See [D6 decision record](../../reviews/2026-09-15-bug-backlog-review.md#d6--how-should-existing-duplicate-identities-be-repaired-011).

## Proposed fix

Use one identity-aware, transactional acceptance workflow across both clients. Offer selection of an
existing managed child, distinguish the child's identity from the recipient email, and make duplicate and
concurrent acceptance safe.

Related: [BUG-012](./012-invite-server-actions-lack-recipient-check.md) covers the missing recipient check
on the same acceptance paths. The two share acceptance boundaries and should be designed together.

~~Historical duplicate repair is out of scope per the D6 clarification above.~~ **Superseded 2026-09-18:** a production check found one duplicate identity. D6 assumed none existed; that was never verified against production data. The repair ships with this fix — see *Historical repair* below.

## Regression test

Cover: parent accepting a player invite on native, the same child invited to a second team, and two
simultaneous acceptances of one invitation.

---

## Fix as implemented

**Branch:** `fix/011-invite-identity`
**PR:** #68, with the production repair completed in #69
**Migrations:** `supabase/migrations/20260918000001_accept_invitation_existing_child.sql` (prevention), `supabase/migrations/20260918000002_merge_managed_profiles.sql` and `20260918000003_merge_managed_profiles_references.sql` (repair)

Two defects, one acceptance path.

### The native app never asked

`apps/mobile/app/invite/[id].tsx` sent `manager` for a "manage an existing player" invitation and `self`
for everything else — so a parent accepting their child's player invitation was enrolled **as the player**,
and the invitation's birthday and gender landed on the parent's profile. `POST /api/invite/[id]/accept`
would have refused `guardian` anyway; it only understood `self` and `manager`.

The screen now asks the same question the web screen does — *are you {player}?* — and a guardian picks their
relationship. The decision is in `apps/mobile/lib/invite-accept.ts` so it can be tested apart from the view,
and an unanswered question is now an error rather than a guess. The route accepts `guardian` with the
relationship, and the public `GET /api/invite/[id]` returns `playerName` so the app can ask by name.

### Guardian acceptance always minted a new child

`accept_invitation` created a fresh profile every time a guardian accepted, so the same child invited to a
second team became two people sharing a name. It now takes an optional `p_managed_profile_id`:

- given, the named child joins the team — one identity, a second membership
- the caller must already manage that profile, or the whole acceptance is refused
  (`NOT_YOUR_MANAGED_PROFILE`, nothing written, the invitation stays pending)
- omitted, behaviour is unchanged: a new managed profile is created
- details are filled in, not overwritten: a birthday the child lacks is taken from the invitation, while a
  name the guardian already recorded survives the coach's spelling of it
- the membership insert is `on conflict do nothing`, so re-accepting for a child already on the team adds
  nothing

Selection is explicit, per D6: nothing is matched by name or birthday.

Both clients offer the choice — a picker on the web identity screen, pills on the native one — and both show
it only when the guardian actually manages someone.

### Already covered, and left alone

Concurrent and repeated acceptance were made safe by
[BUG-012](./012-invite-server-actions-lack-recipient-check.md): the invitation row is locked and
`accepted_at` is checked inside the same transaction. The existing tests for that still pass unchanged, and
the new guardian branch sits inside the same lock.

Historical duplicate repair is out of scope per D6 — the user confirmed no duplicates exist.

### Historical repair — D6's premise did not hold

**Migration:** `supabase/migrations/20260918000002_merge_managed_profiles.sql`

D6 ruled historical repair out of scope because "the user confirms no duplicate identities exist", recording
plainly that this was user-provided context with no production inspection behind it. The duplicate-identity
check written for this fix was run against production on 2026-09-18 and found one:

| Profile | Created | Team | Availability | Training | Guardians |
| --- | --- | --- | --- | --- | --- |
| `8c5cd6ce` | 2026-04-30 | U10 Girls (live club team) | 5 | 4 | 1 |
| `a37d29b9` | 2026-04-01 | GU11 Futsal - England | 15 | 0 | 2 |

Both records of the same child carried real history, so this needed a merge rather than a deletion.

`merge_managed_profiles(p_keep, p_merge)` moves team memberships, availability, training sessions, guardian
links and chat membership onto the surviving record and deletes the other, in one transaction. It is a
repair tool, not a feature: service-role only, and it refuses any profile that has its own login, because a
person with an account owns it.

Where both records held the same thing — the same team, an answer to the same event — the survivor's row
stands and the duplicate is dropped rather than overwriting it. Whatever does not move is removed by the
delete cascading from `profiles`, which also keeps the last-guardian trigger
(`20260917000002_close_guardian_authorization_gaps.sql`) happy: it permits a link to go once the player row
itself is gone, and an explicit delete would have tripped it.

The migration then performs the one production merge, guarded by existence checks on both ids, so it is a
no-op locally, on staging, and on production once it has run. **Survivor: the live club team's record**
(user's choice, 2026-09-18), so its roster row and four training sessions are untouched; the futsal
membership, its 15 responses and the second guardian link move across. Expected result: one Finley, two
teams, 20 responses, 4 training sessions, 2 guardians.

**Tests:** `tests/rls/profile-merge.test.ts` (6) — everything moves; missing details are filled; duplicate
rows collapse to the survivor's; a profile with a login is refused in either position; a record cannot be
merged into itself; and a signed-in user cannot call it.

## Verification

**Tests**

| Test | Covers |
| --- | --- |
| `tests/rls/invitation-identity.test.ts` (6) | Against a real database: a second team joins the existing child rather than creating one, missing details are filled while recorded ones survive, a child the caller does not manage is refused with nothing written, no named child still creates a new player, re-accepting for a child already on the team is harmless, and a named child is ignored when the invitation is accepted as the player themselves |
| `apps/web/tests/invite-accept-api.test.ts` (8) | The route: guardian mode passes the relationship and child through, a missing relationship is refused, a child you do not manage comes back 403, and `self` / `manager` / unknown modes / unauthenticated callers behave as before |
| `apps/mobile/__tests__/invite-accept.test.ts` (7) | The native decision: a manager invitation needs no question, an unanswered question is an error rather than `self`, a guardian must name their relationship, and an existing child is sent only when chosen |

Against the unfixed code, four of the six database tests fail — `accept_invitation` had no
`p_managed_profile_id` argument at all (`PGRST202`), and the invitation's birthday never reached the child.
The native test "refuses to guess when the person has not said who they are" describes exactly what the old
screen did: it sent `self`.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1): RLS **407 passed**, `apps/web`
**789 passed**, `apps/mobile` **38 passed**, `tsc --noEmit` clean for web and mobile, eslint clean,
generated types in sync.

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. The function takes the new argument
select pg_get_function_arguments(oid) from pg_proc where proname = 'accept_invitation';

-- 2. It is still not callable by clients
select has_function_privilege('authenticated', 'accept_invitation(uuid, uuid, text, text, text, text, uuid)', 'execute');

-- 3. No child has two identities: same name, same guardian, two profiles.
--    This found one on 2026-09-18; the repair migration merges it, so after
--    deploy it should come back empty.
select pm.manager_id, lower(p.first_name) as first_name, lower(p.last_name) as last_name, count(*)
from profile_managers pm
join profiles p on p.id = pm.managed_id
where p.auth_user_id is null and pm.manager_id <> pm.managed_id
group by 1, 2, 3
having count(*) > 1;
```

Expected:
1. The argument list ends with `p_managed_profile_id uuid`.
2. `false`.
3. No rows — the production duplicate is merged by this PR. Then confirm the merged child:

   ```sql
   select p.id, p.first_name, p.last_name,
          (select count(*) from team_members    tm where tm.profile_id = p.id) as teams,
          (select count(*) from availability    a  where a.profile_id  = p.id) as availability_rows,
          (select count(*) from training_sessions s where s.profile_id = p.id) as training_sessions,
          (select count(*) from profile_managers  m where m.managed_id = p.id) as guardians
   from profiles p
   where p.id = '8c5cd6ce-0b3b-4d7a-9782-53430c14f952';
   ```

   Expected: 2 teams, 20 availability rows, 4 training sessions, 2 guardians — and
   `a37d29b9-b62a-49c4-90e7-9b8396a6fa81` gone.

**After deploy, the manual check that reproduces the report:** invite a player whose parent already manages
a child on another team, and accept it **in the native app** as the guardian. The app should ask who you
are, offer the child by name, and the roster should show the existing child with two teams — not a second
record, and not the parent enrolled as the player.

---

## The repair failed in production first — 2026-09-18

The merge in `20260918000002` failed when it reached production:

```
ERROR: update or delete on table "profiles" violates foreign key constraint
"invitations_managed_profile_id_fkey" on table "invitations" (SQLSTATE 23503)
Key (id)=(a37d29b9-…) is still referenced from table "invitations".
```

A guardian invitation still named the record being merged away. Most tables referencing `profiles` cascade,
so the delete cleared them; `invitations` does not, deliberately — an invitation records something that
happened, and deleting a person should not quietly erase it. The merge function relied on the cascade and
had nothing to say about the tables that do not.

**Why the tests missed it:** every fixture built a child out of profiles, memberships, availability, training
and guardian links. None had an invitation, which is the one thing a real child acquired on the way in.
`tests/rls/profile-merge.test.ts` now has a case that reproduces the production error exactly (`23503`)
and fails against the old function.

**What the failure left behind:** each migration runs in its own transaction, so production rolled the whole
file back — no function, no merge, and `20260918000002` unrecorded. Staging had recorded it, because the
merge was a no-op with those ids absent. That split is why the fix is a **new** migration
(`20260918000003`) rather than an edit: it redefines the function and runs the merge, so both databases
converge without a staging reset. The merge step was removed from `20260918000002`, which production would
otherwise retry and fail on again.

**The corrected function** repoints every reference that does not cascade — `invitations.managed_profile_id`
and `invited_by`, and `created_by` on `events`, `organizations`, `training_categories` and
`training_sessions` — instead of trusting the delete to clear them. The invitation follows the child.

Full RLS suite after the fix: **408 passed**.

**Deployed and verified 2026-09-18** (PR #68, with the repair completed in #69):
- The staging checks passed before each merge.
- The production merge is confirmed (user): one Finley, both teams, 20 availability responses, 4 training
  sessions, 2 guardians, and `a37d29b9-b62a-49c4-90e7-9b8396a6fa81` gone.
- **Still to confirm:** the native acceptance check — inviting a player whose guardian already manages a
  child on another team, accepting it in the app as the guardian, and seeing the existing child gain a team.
  Until that runs, the prevention half is verified only at the database boundary.
