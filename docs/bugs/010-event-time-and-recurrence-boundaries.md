# BUG-010 — Event times and recurrence boundaries are wrong across timezones

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 10)
**Area:** events / notifications

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

## Fix

Use an explicit event/team timezone for both input and communication, make recurrence boundaries inclusive,
and use actual event dates in reminders.

## Regression test

Cover DST transitions, a coach editing from a different timezone than the team, and recipients in a third
timezone. Pin the suite's TZ rather than inheriting the runner's.
