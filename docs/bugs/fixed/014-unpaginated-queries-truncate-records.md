# BUG-014 — Unpaginated list queries silently omit records at season scale

**Severity:** P1
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 14)
**Area:** performance / data integrity
**Evidence class:** Static (queries) — production row cap **confirmed 1,000** on 2026-09-15; truncation **reproduced** against a seeded database 2026-09-21
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

---

## Fix as implemented

**Branch:** `fix/014-unpaginated-queries`
**PR:** see branch
**Migration:** none

**Decisions taken, 2026-09-21 (user):** window the availability matrix with past and season available on
request; keep the calendar's preload but read it completely; and show an error rather than partial data.

### Reading a list completely

`apps/web/src/lib/supabase/fetch-all-rows.ts` pages with `.range()` until a short page comes back, so
completeness is a property of the loop rather than a bet on staying under a limit that is invisible from the
call site. Pages are 500 rows, half the cap, so a short page is unambiguous.

A page that fails raises `PartialFetchError` instead of returning what arrived. Half a roster looks exactly
like a roster, which is the defect this bug is about. There is also a 20,000-row ceiling: reaching it means
the query is broader than any page should render, and silently truncating there would put us back where we
started.

### The three queries

| Page | Before | After |
| --- | --- | --- |
| Availability matrix | Every event the team ever held, and every response to all of them | A window — upcoming by default, with past 30 days and whole season — and responses only for the events in it |
| Schedule calendar | Every event, ordered oldest first, so the cap dropped the **future** ones | The same preload, read completely in pages |
| Club members | Every member across every team in the org | The same list, read completely in pages |

The availability matrix was the one that mattered: responses multiply events by players, so a season of 50
events and 21 players is 1,050 rows — past the cap, with the dropped rows rendering as "no response".
Windowing ties the row count to what is on screen instead of to how long the team has existed, which also
makes the table readable; a 50-column matrix was not.

Windows are bounded at both ends, "whole season" included — a year either side, not everything.

### Saying so when it fails

`ListLoadError` replaces the list with what happened and how to narrow it. The availability copy names the
reason plainly: a missing response looks the same as "no reply", so showing the table would mislead.

## Verification

**Tests:** `tests/rls/paged-fetch.test.ts` (4) and `apps/web/tests/availability-window.test.ts` (10).

The first seeds **1,050 real availability rows** — 21 players across 50 events, the shape the ticket
describes — and asserts both halves of the bug in one test:

```
the unpaginated query returns exactly 1000   ← what the pages did
fetchAllRows returns 1050, all distinct      ← what they do now
```

The ticket's warning is worth repeating: creating profiles and events does not create responses. The rows
have to be written, or the cap is never reached and the test proves nothing.

The rest: an empty list costs one request, not two; a failure part-way through raises `PartialFetchError`
rather than returning a partial list; and a query that never ends stops at the ceiling. The window tests
cover the default for unrecognised input, each window's bounds, and that all of them are bounded.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1): RLS **412 passed**, `apps/web`
**805 passed**, `tsc --noEmit` clean, eslint clean.

**Not covered by tests:** that production's cap is still 1,000. The fix does not depend on the number — it
depends on not assuming one — but the check below confirms the assumption behind the arithmetic.

**After deploy** (no migration, so nothing to check on staging first):

1. **Availability** opens on upcoming events, and the window control offers past 30 days and whole season.
   Responses shown match what the players actually chose.
2. **Schedule** calendar navigates months as before, and future events are present.
3. **Club members** lists everyone.
4. Production's row cap, in the Supabase dashboard (Project Settings → API → Max rows), is unchanged at
   **1,000**. If it has been raised, the fix still holds — but the ticket's arithmetic would need revisiting.

A live check of the truncation itself needs a team with 1,000+ availability rows, which no real team has
yet; the seeded test is the evidence that the cap no longer truncates.
