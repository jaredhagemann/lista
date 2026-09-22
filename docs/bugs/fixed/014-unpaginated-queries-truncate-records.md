# BUG-014 — Unpaginated list queries silently omit records at season scale

**Severity:** P1
**Status:** Fixed (schedule and availability); the club directory is tracked as BUG-024
**Reported:** 2026-09-04 by readiness review (finding 14)
**Area:** performance / data integrity
**Evidence class:** Static (queries) — production row cap **confirmed 1,000** on 2026-09-15
**Last verified:** code `fa04fc86b`; scale-verified 2026-09-22 against 100,000 events and 4,500 responses

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

Delivered as five pull requests against `docs/specs/schedule-and-availability-pagination.md`, which
**supersedes this ticket's earlier decision to preload the whole calendar**. Preloading was the opposite
of the fix: it moved the same unbounded read earlier, where every tab paid for it.

| PR | What shipped |
| --- | --- |
| [#74](https://github.com/jaredhagemann/lista/pull/74) | Cursor event and response repositories, with validation and projections; `events_team_start_id_idx` |
| [#75](https://github.com/jaredhagemann/lista/pull/75) | Schedule list and calendar read what they show; month cache; timezone fallback with a notice |
| [#76](https://github.com/jaredhagemann/lista/pull/76) | Availability matrix reads one event page, the responses for exactly those events, and a cached roster |
| [#77](https://github.com/jaredhagemann/lista/pull/77) | `set_unanswered_availability`, so bulk covers the window rather than the loaded page |
| this PR | Scale verification, acceptance gaps, ticket updates |

What actually changed, in the terms this ticket was written in:

- **Nothing reads a whole history any more.** Every read is bounded by a date window and a page size,
  ordered by `(start_time, id)` so a page boundary is stable, and continued by a keyset rather than an
  offset. The old schedule query ordered oldest-first, so truncation dropped exactly the future events
  that mattered; there is no truncation now, and the order is explicit.
- **An incomplete read can no longer look like data.** A cell that has not been read is drawn
  differently from one with no response — the specific defect that made this a P1, since a dropped
  availability row rendered as "no response", indistinguishable from a player who never replied. Only a
  complete, successful read permits the dash.
- **A failed read says so** and keeps its controls, instead of rendering as an empty schedule or an
  unanswered team.
- **Bulk availability covers the whole window**, through a `security invoker` database function that
  fills in only blanks, rather than looping over whatever the browser happened to load.
- **Responses cross the cap safely.** A displayed page of ten events on a 150-member team is 1,500
  rows; they arrive complete, in batches, because the batching is keyset-driven rather than trusting one
  request to return everything.

## Verification

**Scale check** — [2026-09-22 verification record](../../reviews/2026-09-22-pagination-scale-verification.md),
harness `tests/scale/pagination-scale.test.ts`, run against 100,000 events, a 151-member roster and
4,500 real response rows, signed in as an ordinary player:

- A list page reads 50 rows and no history, with 99,680 past events present on the team.
- A displayed availability page returns all **1,500** of its responses, past the 1,000-row cap, with no
  duplicates and no missing members — the original reproduction, at three times the scale it asked for.
- The cap itself is asserted at 1,000, so the batching proof is measured against what production
  enforces rather than a friendlier local setting.
- Page 21 costs what page 1 costs (10–17 ms), on an index-only scan whose `Index Cond` is the keyset.
- Bulk sets ~320 events in one request, and returns 0 on a second run rather than overwriting.

**Automated tests** — 907 in `apps/web` and 458 in the RLS suite at the time of writing, including:
traversal at 0/1/pageSize/pageSize+1 and equal timestamps; deletion of a cursor row between requests;
another team's cursor rejected; month boundaries and DST; late months never landing under a later
month's label; unread cells never rendering as "no response"; optimistic edits surviving late reads;
failed writes rolling back only their own cell; and the bulk function's scope, refusals and a genuinely
concurrent competing insert.

**Production** — the three shipped PRs were verified on staging and merged; deployment checks were run
by the maintainer after each.

## Remaining work

The **club member directory**, the third query named above, is unchanged and is tracked as
[BUG-024](../024-club-member-directory-unpaginated.md). The specification excludes it deliberately: it
reads across `organizations → teams → team_members → profiles` rather than events in a window, so the
cursor work does not transfer directly, and how it should be navigated is an unanswered product
question. This ticket is closed for the schedule and availability views only.
