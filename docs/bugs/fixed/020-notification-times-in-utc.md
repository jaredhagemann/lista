# BUG-020 — Event emails and push notifications show times in UTC and call same-day events "tomorrow"

**Severity:** P1
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-17 by the user, from the first production reminder run; split out of
[BUG-010](../010-event-time-and-recurrence-boundaries.md)
**Area:** notifications / events
**Evidence class:** Reproduced in production (reminder email, 2026-09-17); the rest confirmed in code
**Last verified:** production reminder email, 2026-09-17

**Why split from BUG-010:** BUG-010's full fix (decision D5) adds an event-level timezone, timezone-aware event
forms, recurrence across DST, and a backfill. Families meanwhile receive wrong times in every event email,
daily. Per user decision 2026-09-17, notification formatting ships first on its own, using the team's timezone;
under D5 an event's timezone defaults to its team's. BUG-010 keeps the rest.

## Symptom

A practice scheduled **4:00–5:30 PM Pacific** on Thursday, September 17, 2026 produced this reminder email:

```
Event Reminder
Practice
Team      AYSO Girls U10
Type      Practice
Date      Thursday, September 17, 2026
Time      11:00 PM – 12:30 AM
Location  Islay Park
```

4:00 PM Pacific Daylight Time is 23:00 UTC. The email formats the correct instant in the server's UTC zone.

## Reproduction

**Reproduced in production** by the reminders cron, 2026-09-17 12:00 UTC.

1. Schedule an event for a Pacific-time team.
2. Receive any event email or push notification.

**Expected:** times shown in the team's local time, with a timezone label, and the reminder naming the day correctly.
**Actual:** times in UTC with no label; the date is also the UTC date; reminders always say "tomorrow".

## Evidence

Everything produced by the same code is affected:

| Output | Where | Defect |
| --- | --- | --- |
| Email time | `apps/web/src/lib/notifications/email.ts:91` | `toLocaleTimeString` with no `timeZone`, so the server zone (UTC) is used |
| Email date | `email.ts:90` | Same. An event after 5:00 PM Pacific shows the **next day's** date |
| Email arrival time | `email.ts:93` | Same |
| All event emails | `buildEventEmailHtml`, shared by the reminders cron and `/api/notifications/send` (new, updated, cancelled) | Same |
| Reminder subject | `apps/web/src/app/api/cron/reminders/route.ts:130` | Hardcoded `Reminder: {title} tomorrow`. The job runs at 12:00 UTC (5:00 AM Pacific), so same-day events are called "tomorrow" |
| Reminder push | `reminders/route.ts:148` | `Tomorrow at {UTC time}` |
| Event push (new / updated / cancelled) | `apps/web/src/app/api/notifications/send/route.ts:167` | `{server date} at {UTC time}` |

`teams.timezone` exists (IANA names from the team settings form) but is nullable with no default.

## Cause

Notification code formats instants with `Date#toLocale*String` and no `timeZone` option, so output depends on the
server's zone. Production runs in UTC; a developer machine in Pacific time hides the defect. The reminder's
"tomorrow" is a hardcoded string rather than the event's actual day.

## Proposed fix

Format every notification date and time in the team's timezone (`teams.timezone`), always with a timezone label.
When the team has no valid timezone, fall back to UTC — still labeled, so a time is never silently wrong.
Replace the hardcoded "tomorrow" with the event's real relative day in the team's timezone: today, tomorrow, or
the date.

## Regression test

Tests must pin the process timezone to UTC, like production; otherwise a Pacific-time machine passes the unfixed
code.

- a 4:00 PM Pacific event renders "4:00 PM – 5:30 PM PDT" in the email, never "11:00 PM"
- an evening event (after 5:00 PM Pacific) keeps its local date
- a winter event is labeled PST
- a team with no timezone renders UTC, labeled
- a reminder run at 12:00 UTC calls a same-day event "today" and a next-day event "tomorrow", in subject and push
- the new/updated/cancelled push text uses the team's local date and time

## Production details confirmed by the user — 2026-09-17

| Check | Result |
| --- | --- |
| Email subject | `Reminder: Practice tomorrow` — the hardcoded "tomorrow" for a same-day event |
| Push notification | `Reminder: Practice` / `Tomorrow at 11:00PM - Islay park` — hardcoded "tomorrow" and the UTC time |
| Web and mobile app | Show **4:00–5:30 PM**, correctly |
| Stored event and team | `start_time 2026-09-17 23:00:00+00`, `end_time 2026-09-18 00:30:00+00`, team timezone `America/Los_Angeles` |

The stored instants and the team timezone are correct; only notification formatting was wrong. Formatting
23:00 UTC in `America/Los_Angeles` gives exactly 4:00 PM.

---

## Fix as implemented

**Branch:** `fix/020-notification-times`
**PR:** #60
**Migration:** none

- **New `apps/web/src/lib/notifications/event-time.ts`.** Every formatter takes the timezone explicitly and
  labels times with it:
  - `formatEventDate`, `formatShortEventDate`
  - `formatEventTime` ("4:00 PM PDT")
  - `formatEventTimeRange` ("4:00 PM – 5:30 PM PDT")
  - `relativeEventDay` ("today", "tomorrow", or null)
  - `resolveTimeZone`, which falls back to **UTC, still labeled**, when the team has no timezone or an invalid one
- **`buildEventEmailHtml`** takes `timeZone` and formats the date, time range and arrival time with it. The
  builder is shared, so the fix covers reminder, new, updated and cancelled emails.
- **Reminders cron** loads `teams.timezone`:
  - Subject: `Reminder: {title} today` / `tomorrow`, or `on {Thu, Sep 17}` for any other day.
  - Push: `Today at 4:00 PM PDT — Islay Park`.
- **`/api/notifications/send`** loads `teams.timezone` and formats the push as `Thu, Sep 17 at 4:00 PM PDT — Islay Park`.

**Not covered here:**
- **Series-update emails** list changed times as formatted in the **coach's browser**
  (`apps/web/src/components/calendar/event-detail.tsx:272`), in the device's zone with no label. That is correct
  for a coach in the team's zone, and wrong when traveling. It is the device-timezone problem that
  [BUG-010](../010-event-time-and-recurrence-boundaries.md) covers under D5 (timezone-aware event forms).
- **Trial-ending billing email** formats `trialEndsAt` without a timezone (`apps/web/src/lib/notifications/email.ts`,
  trial reminder builder), so the date can be off by one for evening instants. Billing, not events; not
  user-reported. Worth a follow-up if trial dates are shown to clubs.

## Verification

**Tests** — `apps/web/tests/notification-times.test.ts`. They use the real email builder and the real reminders
and send routes, with Supabase and the senders mocked. **The process timezone is pinned to UTC**, like
production. This machine runs `America/Los_Angeles`, where the unfixed code prints "4:00 PM", so an unpinned
test would pass without a fix. A sanity test asserts the pin.

**10 failed against the unfixed code:**

| Test | Unfixed |
| --- | --- |
| reported practice renders `4:00 PM – 5:30 PM PDT` | `11:00 PM – 12:30 AM` |
| arrival time `3:30 PM PDT` | UTC, unlabeled |
| evening event (6:30 PM PDT) keeps date Thursday, September 17 | rendered Friday, September 18 |
| winter event labeled PST, dated Wednesday, January 14 | UTC date and time |
| team timezone `null` → `11:00 PM – 12:30 AM UTC` | no label |
| team timezone invalid → labeled UTC | no label |
| reminder at 12:00 UTC: same-day event subject `Reminder: Practice today`, push `Today at 4:00 PM PDT — Islay Park` | `Reminder: Practice tomorrow` |
| reminder: 4:00 AM PDT next-day event, push `Tomorrow at 4:00 AM PDT — Islay Park` | `Tomorrow at 11:00 AM — Islay Park` |
| reminder: team without timezone labels UTC in email and push | no label |
| updated-event notification: email `4:00 PM – 5:30 PM PDT`, push `Thu, Sep 17 at 4:00 PM PDT — Islay Park` | UTC |

Full runs:
- `apps/web` suite: **732 passed** (previously 721)
- root unit tests run by CI (`tests/unit`, `tests/rrule.test.ts`): **132 passed**, including the email-branding tests that use the same builder
- `tsc --noEmit` and ESLint on changed files: clean

**After deploy — required.** No migration and no SQL check. Confirm with a real notification, either:
- **the next reminder run** (12:00 UTC daily): an email for a same-day event reads `Reminder: {title} today`
  and shows local times with a zone label, or
- **immediately:** edit a future event's details so the "Event Updated" email and push go out, and check
  both show the team's local time and zone label.
