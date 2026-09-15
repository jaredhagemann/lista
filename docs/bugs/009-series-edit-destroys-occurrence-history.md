# BUG-009 — Editing a recurring series destroys availability responses, results and exceptions

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 9)
**Area:** events
**Evidence class:** Mixed — FK cascade loss Reproduced (local stack); full editor workflow Static
**Last verified:** `5acde1074`, local stack + code inspection, 2026-09-04

## Symptom

Changing anything on a recurring series — a venue, say — deletes every child occurrence and rebuilds it
with new IDs. Prior availability responses, game results/scores, per-occurrence cancellations and exceptions are lost, past
events are rewritten, and links to old child IDs break.

## Reproduction

**Evidence split:** the **FK cascade loss was reproduced** by probe. The **full editor workflow** —
delete-all-children-and-reinsert, results clearing, past-event rewriting — is a **static** trace of the
editor, not a live run.

1. Create a weekly series with several past and future occurrences.
2. Record a player's availability for one occurrence; record a score on a past one.
3. Edit the series (change the location) and apply to the whole series.

**Expected:** occurrence identity and existing responses/history survive an edit.
**Actual:** child occurrence availability-row count fell from 1 to 0 in the probe; results are explicitly cleared; cancellation
state and exceptions are not preserved.

## Evidence

- Series rewrite: `apps/web/src/components/calendar/event-detail.tsx:319`
- Availability foreign key (`ON DELETE CASCADE`): `supabase/migrations/20260101000000_initial_schema.sql:56`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Cause

The editor updates the parent, deletes all children, and inserts replacements with fresh UUIDs. Availability
rows reference events with `ON DELETE CASCADE`, so they are removed with the children. Past children are
included in the rewrite. Because delete and insert are separate requests, a failure between them leaves a
partially rebuilt schedule.

## Product decisions

**D4 resolved — September 15, 2026:**

- Use “availability” for the player's event response, whether entered by the player or their guardian.
- Date, time and venue changes leave availability responses unchanged. Restoration also preserves the
  saved responses. D3 notifications give players/guardians the opportunity to update availability.
- Do not add a reconfirmation state, stale-response flag or separate confirmation data. Existing
  availability continues to count normally after a schedule change.
- Offer this occurrence, this and following occurrences, or all upcoming occurrences as edit scopes.
  Bulk series edits leave past events untouched; historical corrections are explicit single-event edits
  with retained history.
- Preserve occurrence identities, links, results and availability history. Preserve individually canceled
  or rescheduled exceptions during bulk edits.
- Removed dates are canceled/archived with their records retained. Newly added occurrences have no
  availability responses. Preview affected dates before applying recurrence changes.
- Apply the operation atomically and notify according to D3's batching rules.

See [D4 decision record](../reviews/2026-09-15-bug-backlog-review.md#d4--what-happens-to-availability-responses-and-exceptions-when-a-series-changes-009-010).
No application fix has been implemented.

## Proposed fix

Preserve occurrence IDs and existing response/history records; support "this and future occurrences"; apply
the mutation transactionally; retain explicit exceptions and revisions. Make destructive removal a distinct,
reviewable operation.

## Regression test

Assert that after a series edit: availability values remain unchanged and count normally after date/time/
venue changes or restoration; results and individual exceptions survive; past occurrences are untouched;
and a mid-operation failure leaves the schedule intact. Verify removed dates retain history and newly
added occurrences start without availability responses. No reconfirmation model is required.

Also assert links to occurrence IDs remain stable across an edit, so a saved link or notification
reference does not break.
