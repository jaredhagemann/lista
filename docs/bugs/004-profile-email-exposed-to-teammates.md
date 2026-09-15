# BUG-004 — Private contact fields are readable by any teammate via the data API

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 4)
**Area:** privacy / rls
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

## Symptom

The privacy page states that email is visible to admins and profile managers. In fact an ordinary player
account can read any teammate's email — including a coach's — by querying `profiles` directly. The UI
hides the field; the data boundary does not.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as an ordinary player on a team.
2. `SELECT email FROM profiles WHERE id = '<coach profile uuid>'` via PostgREST.

**Expected:** no email returned — private contact fields are not part of the team-visible projection.
**Actual:** the coach's email is returned.

**Deployment status:** the evidence supports local email exposure. It does **not** establish that the
deployed policy is identical.

## Evidence

- Privacy statement: `apps/web/src/app/privacy/page.tsx:48`
- Profile visibility policy: `supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql:14`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Product decisions

**Email needs no new decision** — the privacy page already promises it. Enforcing an existing promise is a
straight repair and should not wait on the open rows below.

Tracked as **D8** in `docs/reviews/2026-09-15-bug-backlog-review.md`:

| Question | Recommendation | Decision |
| --- | --- | --- |
| Who may see full DOB vs. birth year only? | Restrict full DOB to justified roles | **Open** |
| Who may see contact details beyond email? | Teammates get only required roster fields | **Open** |
| Access matrix across self / guardian / team player / team coach-manager / org director / unrelated | Distinguish all six | **Open** |

Children's photos are the same decision, tracked in
[BUG-016](./016-storage-buckets-private-vs-public-url.md).

## Cause

Team-visible profile rows expose whole columns rather than a restricted public-profile projection.

## Proposed fix

Separate public roster fields from private account/contact fields. **A secured view or server response is
not sufficient on its own** — if unrestricted direct access to the base table remains, the projection is
decoration. The base-table policy has to be the boundary.

Preserve each user's access to their own private data.

## Regression test

Assert against **direct PostgREST queries** on the base table, not rendered screens, for each role: self,
player, guardian, coach, manager, org director, unrelated user. Include the positive case — a user reading
their own email must keep working.
