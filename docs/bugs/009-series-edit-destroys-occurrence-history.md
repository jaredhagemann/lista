# BUG-009 — Editing a recurring series destroys RSVPs, results and exceptions

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 9)
**Area:** events

## Symptom

Changing anything on a recurring series — a venue, say — deletes every child occurrence and rebuilds it
with new IDs. Prior RSVPs, game results/scores, per-occurrence cancellations and exceptions are lost, past
events are rewritten, and links to old child IDs break.

## Reproduction

**Code-confirmed; cascade loss reproduced** via probe.

1. Create a weekly series with several past and future occurrences.
2. Have a player RSVP to one occurrence; record a score on a past one.
3. Edit the series (change the location) and apply to the whole series.

**Expected:** occurrence identity and existing responses/history survive an edit.
**Actual:** child RSVP count fell from 1 to 0 in the probe; results are explicitly cleared; cancellation
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

## Fix

Preserve occurrence IDs and existing response/history records; support "this and future occurrences"; apply
the mutation transactionally; retain explicit exceptions and revisions. Make destructive removal a distinct,
reviewable operation.

## Regression test

Assert that after a series edit: prior RSVPs survive, recorded results survive, per-occurrence cancellations
survive, past occurrences are untouched, and a mid-operation failure leaves the schedule intact.
