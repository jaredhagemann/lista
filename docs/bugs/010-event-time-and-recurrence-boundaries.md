# BUG-010 — Event times and recurrence boundaries are wrong across timezones

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 10)
**Area:** events / notifications
**Evidence class:** **Email times reproduced in production** (2026-09-17); recurrence boundary reproduced locally (unit probe)
**Last verified:** production reminder email, 2026-09-17 — see Reproduced in production

**Split 2026-09-17 (user decision):** the notification formatting defects below — email times and dates, the
"tomorrow" wording, and push text — moved to [BUG-020](./fixed/020-notification-times-in-utc.md) to ship first, using
the team's timezone. BUG-010 keeps the event-level timezone field, timezone-aware forms, recurrence and backfill (D5).

## Reproduced in production — 2026-09-17

Reported by the user from the first real reminder run after [BUG-008](./fixed/008-cron-routes-redirected-to-login.md)
was fixed. Event: **Practice**, team AYSO Girls U10, Islay Park, scheduled **4:00–5:30 PM Pacific** on
Thursday, September 17, 2026. The reminder email showed:

```
Event Reminder

Practice
Team      AYSO Girls U10
Type      Practice
Date      Thursday, September 17, 2026
Time      11:00 PM – 12:30 AM
Location  Islay Park
```

4:00 PM Pacific Daylight Time is 23:00 UTC, and 5:30 PM is 00:30 UTC. **The email shows the correct instant
formatted in the server's UTC zone.** This is exactly the defect the September 4 review predicted.

### Everything the same code produces wrong (static, confirmed in code 2026-09-17)

| Output | Where | Defect |
| --- | --- | --- |
| Email **time** | `apps/web/src/lib/notifications/email.ts:91` | `toLocaleTimeString` with no `timeZone`, so the server zone (UTC) is used |
| Email **date** | `email.ts:90` | Same formatting. Correct for this event only by coincidence: an event after **5:00 PM Pacific** shows the **next day's** date |
| Email **arrival time** | `email.ts:93` | Same formatting |
| **Every** event email, not just reminders | `buildEventEmailHtml` is shared with `/api/notifications/send` (new, updated, cancelled) | Same defect on all of them |
| Reminder **subject** | `apps/web/src/app/api/cron/reminders/route.ts:130` | Hardcoded `Reminder: {title} tomorrow`. The job runs at 12:00 UTC (5:00 AM Pacific), so a same-day event is called "tomorrow" |
| Reminder **push** text | `reminders/route.ts:148` | `Tomorrow at {time}`: both "tomorrow" and the UTC time are wrong |

Teams already have a `timezone` column. Events do not yet; D5 adds one.

**Evidence class for the email defect upgraded:** reproduced in production.

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

**Also for D5's form work (noted 2026-09-17, from BUG-020):** series-update notifications list changed times as
formatted in the coach's browser (`apps/web/src/components/calendar/event-detail.tsx:272`), in the device's zone
with no label. Timezone-aware event forms should format these in the event's timezone.
