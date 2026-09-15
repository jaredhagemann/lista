# BUG-014 — Unpaginated list queries silently omit records at season scale

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 14)
**Area:** performance / data integrity

## Symptom

The schedule, availability matrix and club member list each fetch every matching row in one unbounded
query. Past the API's configured 1,000-row cap, records are silently dropped: missing availability rows
render as **"no response"** rather than as an error, and a long-lived team's future events can disappear
once older events fill the cap.

## Reproduction

**Code-confirmed; production row limit unverified.**

1. Create a team with 20 players and 51 events (**20 × 51 = 1,020 responses**, past the 1,000 cap).
2. Open the availability matrix.

**Expected:** every response renders, or an explicit "could not load" state.
**Actual:** truncated rows render as "no response" — indistinguishable from a genuine non-reply.

**Environment:** the 1,000 cap is from the checked-in `config.toml`. **The production cap has not been
verified** — see "Questions".

## Evidence

- Schedule query: `apps/web/src/app/dashboard/schedule/page.tsx:26`
- Availability query: `apps/web/src/app/dashboard/availability/page.tsx:62`
- Club member query: `apps/web/src/app/dashboard/club/members/page.tsx:100`
- Configured cap: `supabase/config.toml:17`

## Cause

No pagination or date-windowing on any of the three queries; the schedule additionally orders oldest-first,
so truncation drops the *future* events that matter most.

## Fix

Query bounded date windows, paginate on the server, fetch RSVPs only for the displayed window, and
distinguish a failed or incomplete query from a genuinely empty result. Do not simply raise the cap.

## Regression test

Seed past the cap and assert completeness, plus that a truncated/failed fetch surfaces as an error state
rather than as empty data.
