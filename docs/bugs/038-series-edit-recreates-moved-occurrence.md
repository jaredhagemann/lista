# BUG-038 — A series edit recreates an occurrence that was moved to another day

**Severity:** P2
**Status:** Open
**Reported:** 2026-10-26 by the reminder-rules review (RR-002), which found it while reproducing a
reminder-only edit. That fix routed reminder-only edits around it; every other series edit still hits it.
**Area:** events
**Evidence class:** Mixed. Reproduced for the planner (unit probe, below); the RPC path was reproduced by
the RR-002 review against local Supabase with a reminder edit. The same RPC path for other fields is Static.
**Last verified:** `e2b142e10`, local planner probe

## Symptom

A coach moves one occurrence of a weekly series to another day, say Thursday Dec 10 to Friday Dec 11.
Later they edit the entire series, for example to change the title. The edit offers to **add** an event on
Thursday Dec 10. If they confirm, the series has both the Friday event and a new Thursday one, and the team
gets a notice about the added event.

## Reproduction

1. Weekly Thursday series: Dec 3, 10 and 17, 2026, 16:00 UTC.
2. Move the Dec 10 occurrence on its own to Friday Dec 11, keeping it in the series.
3. Edit the entire series and change only the title.

**Expected:** the title changes on Dec 3, Dec 11 (or not, per the existing "exceptions are left alone"
rule) and Dec 17. Nothing is added.
**Actual:** `planSeriesEdit` returns one insert, on Dec 10 at 16:00, and the editor shows the "added"
confirmation (D4). Applying it inserts the event and queues a notice.

Planner probe at `e2b142e10`, with `fields: { title: "Team practice" }`, scope `series`, now Nov 20:

```
{"inserts":["2026-12-10T16:00:00.000Z"],"updates":["head","last"]}
```

## Evidence

- `apps/web/src/lib/events/series-edit.ts:265`: `isException` treats an occurrence whose start isn't a
  pattern slot as rescheduled, which is right.
- `apps/web/src/lib/events/series-edit.ts:298-299`: an exception marks **its current date** (Dec 11) as
  filled, not the slot it came from (Dec 10).
- `apps/web/src/lib/events/series-edit.ts:327`: every pattern date not filled gets an insert, so Dec 10 is
  "missing" and re-added.
- An occurrence moved within its own day isn't affected: its date still matches its slot.
- `docs/reviews/2026-10-26-reminder-rules-review.md`, RR-002: the same behavior reproduced through
  `apply_series_edit` against local Supabase (one insert, one notice job).

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Which slot does a moved occurrence hold? Events don't record their original slot, so a move to another day can't be told apart from a gap plus an extra event. | Record it: an `original_start` (or slot date) column set when an occurrence is moved on its own, and the planner counts that slot as filled. Without it, any rule (nearest slot, same week) guesses wrong for some moves. | Open | | |
| What happens to existing moved occurrences that have no recorded slot? | Treat their nearest unfilled pattern slot within the same week as theirs, once, when backfilling. | Open | | |

## Proposed fix

Settle the decisions first. Then record the slot an occurrence came from when it's moved on its own, and
have `planSeriesEdit` mark that slot's date as filled for exceptions, as well as their current date.

## Regression test

- Planner: the reproduction above produces no inserts, for a title edit, a time edit and a pattern change
  that keeps the moved occurrence's original slot.
- Planner: a pattern change that *drops* the original slot's weekday doesn't resurrect it either.
- RLS (`tests/rls/event-series.test.ts`): applying a title edit to a series with a date-moved occurrence
  keeps the event count and ids, and the notice reports no added events.
- Legitimate path: an occurrence actually deleted from the series (not moved) is still re-added when the
  pattern is extended over its date, as today.
