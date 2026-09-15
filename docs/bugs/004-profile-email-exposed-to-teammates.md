# BUG-004 — The privacy page misstates who can see contact details

**Severity:** P2 (regraded from P1 on 2026-09-15 — see Severity note)
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 4)
**Area:** privacy / rls
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

**Severity note.** This was filed as a P1 data-boundary bypass: the privacy page promised email was
admin-only, and a teammate could read it. **The D8 decision below inverts that** — teammate visibility is
now the intended behavior, so the code is right and the published promise is wrong. What remains is a
documentation correction plus a scope-widening feature, not an access-control bypass. Regraded P2.

The correction is still worth doing promptly: the app currently publishes a privacy statement that
under-describes what it shares, for a product handling children's data.

## Symptom

`apps/web/src/app/privacy/page.tsx:48` tells users their email address is visible **only** to team admins
(coaches, managers, directors) and profile managers. In fact any teammate can read it by querying
`profiles` directly, which — per D8 — is what Lista intends to do. The published statement does not match
the product.

The page is also silent on date of birth, which D8 now places in teammate/clubmate scope.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an ordinary player on a team.
2. `SELECT email FROM profiles WHERE id = '<coach profile uuid>'` via PostgREST.

**Actual:** the coach's email is returned.
**Expected under D8:** returned — this is now correct behavior for a teammate.
**Expected under the privacy page as written:** not returned.

The defect is the disagreement between those last two lines.

**Deployment status:** the deployed policy has not been checked.

## Evidence

- Privacy statement: `apps/web/src/app/privacy/page.tsx:48`
- Profile visibility policy: `supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql:14`
- `is_team_member` is **team**-scoped: `supabase/migrations/20260416000002_director_role_and_rls_helpers.sql:29`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Product decisions

**D8 resolved — user decision, 2026-09-15:** date of birth, birth year, contact details and children's
photos may be viewed by **teammates and clubmates**. No access outside the team/club.

| Field | Decision | Current behavior |
| --- | --- | --- |
| Email / contact details | Teammates and clubmates | Teammates only — **narrower** than decided |
| Full DOB and birth year | Teammates and clubmates | Teammates only — **narrower** than decided |
| Children's photos | Teammates and clubmates | See [BUG-016](./016-storage-buckets-private-vs-public-url.md) |
| Anyone outside the team/club | **No access** | Denied by the profiles policy — but see the caveat below |

**Open sub-question — does "clubmates" mean cross-team?** Profile reads are team-scoped today. Reading the
decision literally, a parent on the U10 boys team would gain access to the DOB and phone number of every
player on every other team in the club. That is net-new widening, not enforcement. Confirm before building
it; the rest of this ticket does not depend on the answer.

## Cause

Two independent gaps, neither of which is the one originally filed:

1. **The privacy page was written against a narrower intent than D8.** It is a documentation defect.
2. **Club-wide visibility does not exist.** `is_team_member` scopes reads to shared teams, so clubmates on
   different teams cannot see each other. This is narrower than D8 allows.

**Caveat on the boundary.** D8's "no access outside the team/club" is **not currently enforced** — not
because of the profiles policy, which is correctly scoped, but because
[BUG-001](./001-team-members-self-insert-coach.md) lets any authenticated user insert themselves into any
team and thereby become a "teammate." **Fixing BUG-001 is what actually enforces D8's outer boundary.**
That dependency is the most important thing on this ticket.

## Proposed fix

1. Correct the privacy page to describe what D8 decided, covering email, contact details and date of birth.
2. Only if cross-team visibility is confirmed: widen the profiles policy from team scope to club scope.
3. Preserve each user's access to their own private data.

Do not relax the outer boundary. Enforcing it is [BUG-001](./001-team-members-self-insert-coach.md)'s job.

## Regression test

Assert against **direct PostgREST queries** on the base table, not rendered screens:

- self reads own email and DOB — permitted
- teammate reads email and DOB — permitted (D8)
- clubmate on a different team — matches whatever the open sub-question resolves to
- **unrelated user outside the team and club — denied**, which is the case that must not regress
- guardian reads their managed child — permitted

Add a check that the privacy page's claims match the policy, so the two cannot drift apart again.
