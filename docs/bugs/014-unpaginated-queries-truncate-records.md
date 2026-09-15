# BUG-014 — Unpaginated list queries silently omit records at season scale

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 14)
**Area:** performance / data integrity
**Evidence class:** Static (queries) — production row cap **confirmed 1,000** on 2026-09-15
**Last verified:** code `5acde1074`; production cap checked in the Supabase dashboard 2026-09-15

## Symptom

The schedule, availability matrix and club member list each fetch every matching row in one unbounded
query. Past the API's configured 1,000-row cap, records are silently dropped: missing availability rows
render as **"no response"** rather than as an error, and a long-lived team's future events can disappear
once older events fill the cap.

## Reproduction

**Static.** Not yet run.

1. Seed **1,020 actual availability records**. Note that creating 20 profiles and 51 events does *not*
   create responses — the rows have to be written, or the cap is never reached and the test proves nothing.
2. Open the availability matrix.

**Expected:** every response renders, or an explicit "could not load" state.
**Actual:** truncated rows render as "no response" — indistinguishable from a genuine non-reply.

**Deployment status — confirmed 2026-09-15.** Production is **also set to 1,000 rows**, checked in the
Supabase dashboard. The cap is no longer hypothetical: the arithmetic below applies to the live
database, and any team that reaches 1,020 availability records will silently lose rows today.

## Evidence

- Schedule query: `apps/web/src/app/dashboard/schedule/page.tsx:26`
- Availability query: `apps/web/src/app/dashboard/availability/page.tsx:62`
- Club member query: `apps/web/src/app/dashboard/club/members/page.tsx:100`
- Configured cap (local): `supabase/config.toml:17`
- Production cap: Supabase dashboard, Project Settings → API → Max rows — **1,000**, confirmed 2026-09-15

## Cause

No pagination or date-windowing on any of the three queries; the schedule additionally orders oldest-first,
so truncation drops the *future* events that matter most.

## Proposed fix

Query bounded date windows, paginate on the server, fetch availability only for the displayed window, and
distinguish a failed or incomplete query from a genuinely empty result. Do not simply raise the cap.

A failed-load state protects against a false "no response", but it is not the whole fix: **normal
season-sized data must still load completely.** An honest error where a coach expects a roster is still a
broken roster.

## Regression test

Seed past the cap with real availability rows and assert completeness.

Assert a truncated or failed fetch surfaces as an error state rather than as empty data — and separately,
that a normal season's data loads in full without hitting that state.
