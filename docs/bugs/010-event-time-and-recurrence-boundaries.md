# BUG-010 — Event times and recurrence boundaries are wrong across timezones

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 10)
**Area:** events / notifications
**Evidence class:** Reproduced (local unit probes) — 2 of the 5 assertions in the Sept 4 probe file
**Last verified:** `5acde1074`, local unit probe, 2026-09-04

## Symptom

Three related time defects:

1. A series ending on a day the practice falls on omits that final occurrence.
2. Notification emails render event times in the **server's** timezone — a Monday 6 p.m. Los Angeles
   practice reads as "Tuesday at 1 a.m." on a UTC server.
3. The reminder job labels everything in its next-24-hours window "tomorrow," including same-day events.

## Reproduction

**Reproduced** for recurrence and email formatting.

Recurrence:
1. Create a weekly Monday 6 p.m. series starting September 7, ending September 14.

**Expected:** two occurrences (Sep 7 and Sep 14).
**Actual:** one occurrence (Sep 7 only).

Email formatting:
1. Build a notification email for a Monday 6 p.m. America/Los_Angeles event on a UTC server.

**Expected:** "Monday at 6:00 PM" in the team's timezone.
**Actual:** "Tuesday at 1:00 AM".

## Evidence

- Recurrence end date: `apps/web/src/components/calendar/event-form-dialog.tsx:203`
- Email formatting: `apps/web/src/lib/notifications/email.ts:90`
- Reminder wording: `apps/web/src/app/api/cron/reminders/route.ts:131`
- Probe code: `docs/reviews/2026-09-04-routing-time-probes.test.ts`

## Cause

`new Date(recurUntil)` yields midnight on the end date, so an evening occurrence on that date falls outside
the boundary. The email builder formats using the server's local zone without supplying the team timezone.
Event forms use the editing device's timezone even though a team timezone setting already exists.

## Product decisions

**D5 resolved — September 15, 2026:** events must include their own timezone field. Default it to the
team's timezone and allow an event-level override for events in other locations.

- Store a named timezone (for example, `America/Denver`) alongside the event timestamps.
- Interpret date/time inputs in the selected event timezone. Display the event's local time and a clear
  timezone label in the UI and communications, regardless of the device/server timezone.
- Changing the team's default timezone must not shift or reinterpret existing events.
- Recurrence retains its local clock time across DST using the event timezone. Its end date is inclusive
  in that zone; reminders use correct event-local dates and wording.
- Preserve existing stored instants during backfill of the timezone field.
- Scheduled-time changes follow D3 notification rules and leave availability unchanged under D4.

See [D5 decision record](../reviews/2026-09-15-bug-backlog-review.md#d5--what-timezone-defines-an-event-010).
No application or schema change has been implemented.

## Proposed fix

Add the event timezone field and use it consistently for input, UI display, communications and recurrence.
Make recurrence boundaries inclusive and use actual event-local dates in reminders. Follow the accepted
D5 rules for defaults, overrides, DST, existing events and migration.

## Regression test

Cover an event outside the team timezone, a coach editing from a third timezone, DST transitions,
inclusive end dates and consistent UI/email/reminder dates. Assert changing the team default does not
shift existing events and backfilling the event timezone preserves stored instants. Pin the suite's TZ
rather than inheriting the runner's.
