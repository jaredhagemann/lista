# BUG-024 — The club member directory still fetches every member at once

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-22, split out of BUG-014
**Area:** performance / data integrity
**Evidence class:** Static (query) — production row cap **confirmed 1,000** on 2026-09-15
**Last verified:** code `fa04fc86b`

## Symptom

The club member directory reads every member of every team in the organization in one unbounded query.
Past the API's 1,000-row cap the extra rows are dropped without an error, so the directory shows a
shorter club than the one that exists — and nothing on the page says so.

This is the third of the three queries BUG-014 named. The other two, the schedule and the availability
matrix, were fixed by `docs/specs/schedule-and-availability-pagination.md`, which deliberately excludes
this one: it is a different shape of read, over `organizations → teams → team_members → profiles`
rather than over events in a date window, so none of the cursor work transfers directly.

## Reproduction

**Static.** Not yet run against seeded data.

1. Seed an organization with more than 1,000 team memberships across its teams — memberships, not
   teams or profiles alone, since the cap applies to the returned rows.
2. Open the club member directory.

**Expected:** every member appears, or the page says it could not load them all.
**Actual:** the first 1,000 rows appear and the rest are silently missing.

## Evidence

- `apps/web/src/app/dashboard/club/members/page.tsx:100`
- Production cap: Supabase dashboard, Project Settings → API → Max rows — **1,000**, confirmed 2026-09-15
- The excluding decision: `docs/specs/schedule-and-availability-pagination.md` §1 — "The club member
  directory remains a separate part of BUG-014; completing this specification does not resolve that
  directory's review findings."

## Cause

No pagination, no windowing, and no distinction between "this is the whole club" and "this is as much
of the club as one request returns".

## Proposed fix

Not yet designed. Two things the schedule work established are worth reusing, whatever the shape:

- **A keyset, not an offset.** Ordering by a unique key — `(team_id, profile_id)` is the existing unique
  constraint — makes a page boundary stable while people join and leave.
- **An incomplete read must not render as a short list.** The defect that made BUG-014 a P1 was that
  missing rows looked exactly like real data. A directory missing 200 people looks like a smaller club.

Whether the directory paginates, searches, or groups by team is a product question that has not been
asked yet. It is not obviously the same answer as the schedule's Previous/Next.

## Regression test

Seed past the cap with real memberships and assert every member is reachable; assert that a failed or
incomplete read surfaces as an error rather than as a shorter club.

## Product decisions

| Question | Options | Status |
| --- | --- | --- |
| How the directory is navigated | Paginate / search-first / group by team | Open |
| Whether a member count is shown, and whether it is exact | — | Open |
