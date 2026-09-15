# BUG-004 — The privacy page misstates who can see contact details

**Severity:** P2 (regraded from P1 on 2026-09-15 — see Severity note)
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 4)
**Area:** privacy / rls
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

**Severity note.** This was filed as a P1 data-boundary bypass: the privacy page promised email was
admin-only, and a teammate could read it. **The D8 decision below inverts that** — teammate visibility is
the intended behavior, so the code is right and the published promise is wrong. What remains is a
documentation correction, not an access-control bypass. Regraded P2.

The correction is still worth doing promptly: the app publishes a privacy statement that under-describes
what it shares, for a product handling children's data.

## Symptom

`apps/web/src/app/privacy/page.tsx:48` tells users their email address is visible **only** to team admins
(coaches, managers, directors) and profile managers. In fact any teammate can read it by querying
`profiles` directly, which — per D8 — is what Lista intends. The published statement does not match the
product.

The page is also silent on date of birth, which D8 places in teammate scope.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an ordinary player on a team.
2. `SELECT email FROM profiles WHERE id = '<coach profile uuid>'` via PostgREST.

**Actual:** the coach's email is returned.
**Expected under D8:** returned — correct behavior for a teammate.
**Expected under the privacy page as written:** not returned.

The defect is the disagreement between those last two lines.

**Deployment status:** the deployed policy has not been checked.

## Evidence

- Privacy statement: `apps/web/src/app/privacy/page.tsx:48`
- Profile visibility policy: `supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql:14`
- `is_team_member`: `supabase/migrations/20260416000002_director_role_and_rls_helpers.sql:29`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Product decisions

**D8 resolved — user decision, 2026-09-15:** date of birth, birth year, contact details and children's
photos are visible to **teammates**. No access outside the team. **No cross-team clubmate widening** — the
current team-scoped behavior is correct and stays as it is.

| Viewer | Access | Status |
| --- | --- | --- |
| Self | Own data | Already correct |
| Teammate (shares a team) | DOB, birth year, contact details, photos | Already correct |
| Guardian of a managed player | Their child's data | Already correct |
| Clubmate on a **different** team | **No access** | Already correct — do not widen |
| Org director / owner | Club-wide, by existing design — see below | Already correct |
| Anyone outside the team/club | **No access** | See the BUG-001 caveat below |

**Director and owner access is the one exception, and it is intentional.** `is_team_member` ends with
`OR is_org_admin(team_org_id(t_id))` (`supabase/migrations/20260416000002_director_role_and_rls_helpers.sql:50`),
so org admins have implicit access to every team in their club without a `team_members` row. That is
deliberate, documented in the migration, and consistent with the multi-tenant spec. D8 does not change it.

So "teammates only" is exact for ordinary members — players, parents, coaches and managers — and directors
and owners see the whole club by design.

## Cause

**The privacy page was written against a narrower intent than D8.** That is the whole defect. The data
layer already implements the decided behavior.

**Caveat on the outer boundary.** D8's "no access outside the team" is **not currently enforced** — not
because of the profiles policy, which is correctly scoped, but because
[BUG-001](./001-team-members-self-insert-coach.md) lets any authenticated user insert themselves into any
team and thereby become a "teammate." **Fixing BUG-001 is what actually enforces D8's outer boundary.**
That dependency is the most important thing on this ticket; the privacy-page edit is the easy half.

## Proposed fix

Correct the privacy page to describe what D8 decided — email and contact details, date of birth, and
photos are visible to teammates; directors and owners see their whole club.

Change **no policy**. The data layer is already correct, and widening it to clubmates was explicitly
declined.

## Regression test

Assert against **direct PostgREST queries** on the base table, not rendered screens:

- self reads own email and DOB — permitted
- teammate reads email and DOB — permitted (D8)
- **clubmate on a different team — denied**, which is the case that must not silently widen
- org director reads any profile in their club — permitted (existing design)
- **unrelated user outside the team and club — denied**, which is the case that must not regress
- guardian reads their managed child — permitted

Add a check that the privacy page's claims match the policy, so the two cannot drift apart again.
