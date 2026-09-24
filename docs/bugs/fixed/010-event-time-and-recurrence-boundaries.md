# BUG-010 — Event times and recurrence boundaries are wrong across timezones

**Severity:** P1
**Status:** Fixed
**Reported:** 2026-09-04 by readiness review (finding 10)
**Area:** events / notifications
**Evidence class:** **Email times reproduced in production** (2026-09-17); recurrence boundary reproduced locally (unit probe)
**Last verified:** fix on `fix/010-event-time-and-recurrence-boundaries`, local stack, 2026-09-23 — see Verification

**Split 2026-09-17 (user decision):** the notification formatting defects below — email times and dates, the
"tomorrow" wording, and push text — moved to [BUG-020](./020-notification-times-in-utc.md) to ship first, using
the team's timezone. BUG-010 keeps the event-level timezone field, timezone-aware forms, recurrence and backfill (D5).

**Symptom 1 fixed by [BUG-009](./009-series-edit-destroys-occurrence-history.md) (2026-09-17):** "Repeat until" now
includes that day, both when creating a series and in the series editor. New rules also store their start (`DTSTART`).
The event-level timezone field and backfill (D5) are still open here.

## Reproduced in production — 2026-09-17

Reported by the user from the first real reminder run after [BUG-008](./008-cron-routes-redirected-to-login.md)
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

See [D5 decision record](../../reviews/2026-09-15-bug-backlog-review.md#d5--what-timezone-defines-an-event-010).

**Settled 2026-09-23 (user), where D5 was silent:**

| Question | Decision |
| --- | --- |
| Backfill for events on a team with **no** timezone | Leave `events.timezone` unset. They keep following the team (then the viewer) until someone gives them a zone. Every **new** event gets one. Stored instants never change. |
| Can the series editor change a whole series' zone? | Yes. Upcoming occurrences keep their local clock time in the new zone, under the usual "this and following" / "entire series" rules. |
| Mobile display | In this fix. Ships with the held mobile build ([release notes](../../releases/mobile-next.md)). |

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

---

## Fix as implemented

**Branch:** `fix/010-event-time-and-recurrence-boundaries`
**PR:** #81
**Migrations:** `supabase/migrations/20260923000001_event_timezone.sql`, `20260923000002_event_timezone_first_record_is_not_news.sql`

The cause was that every conversion between a wall-clock time and an instant used whichever zone the code
happened to run in: the coach's browser for forms and series, the phone for the mobile app. An event now
records the zone its local times mean, and every conversion names it.

**Database** (`20260923000001_event_timezone.sql`):
- `events.timezone` (IANA name). Backfilled from `teams.timezone` where the team has a valid zone. Only the
  zone is written; `start_time` and `end_time` are untouched.
- A `BEFORE INSERT OR UPDATE OF timezone` trigger defaults a new event to its team's zone at that moment, and
  refuses a name missing from `pg_timezone_names` (`INVALID_TIMEZONE`). Nothing copies the team's zone
  later, so changing it never shifts or relabels existing events.
- `event_notification_snapshot` includes `timezone`. The change trigger counts a zone change as a schedule
  change (`updated`, D3): the same wall-clock time in another zone is another time.
- `apply_series_edit` gives new occurrences the plan's zone, or else the series head's, and applies a
  `timezone` field on in-place updates.

**Web:**
- **New `apps/web/src/lib/events/event-timezone.ts`:**
  - `wallClockIn` and `instantFromWallClock` convert in a named zone. A repeated fall-back time takes
    the earlier instant, and a skipped spring-forward time moves past the gap.
  - `expandInZone` expands a rule in the event's zone, so a series keeps its local clock time across DST.
  - `eventTimeZone` resolves the zone in order: event, team, viewer.
  - `COMMON_TIME_ZONES` is the list the team settings form already used, moved here to be shared.
  - `month-range.ts` now reuses its `offsetAt`.
- **Create form** (`event-form-dialog.tsx`): a **Time zone** picker (`time-zone-select.tsx`) that defaults
  to the team's zone, or the coach's own zone labeled as such if the team has none. Inputs are read in the
  picked zone, and `timezone` is stored. The calendar passes the clicked day as `YYYY-MM-DD` rather than a
  browser-local `Date`.
- **Single-event editor** (`EventEditForm` in `event-detail.tsx`): shows and reads times in the event's
  zone. Changing the zone keeps the typed local times. `pinnedStartRule` pins a legacy head in the event's
  zone.
- **Series editor and planner** (`series-edit-form.tsx`, `series-edit.ts`):
  - `planSeriesEdit` takes `timeZone` (required) and an optional `newTimeZone`.
  - Exceptions, slots and new instants are all computed in the series' zone.
  - A zone change moves upcoming non-exception occurrences to the same local time in the new zone, and
    records it on each one.
  - The picker, change summary and preview are all zone-aware.
- **Display:** the schedule list, event detail and dashboard show each event's times in its own zone with a
  label (`4:00 PM – 5:30 PM MDT`). This also covers the series-update formatting BUG-020 left here.
- **Notifications:** the worker and the reminders cron format in `snapshot.timezone` or `event.timezone`,
  falling back to the team's zone for events and queued jobs from before event zones.
- The calendar grid still groups days in the **team's** zone. It is the team's calendar, and it shows no
  times.

**Mobile** (ships with the held build): `apps/mobile/lib/event-time.ts`. The home, schedule and event
screens show times in the event's zone, else the team's, with a label. This also fixes "Arrive by", which
formatted the arrival offset (minutes) as a date. Jest is now pinned to `Asia/Tokyo`.

## Verification

Every new suite pins the process zone to one that neither the event nor the server is in: Tokyo in the
unit, component and database tests, and Pacific for a Denver series in the planner. A hidden use of the
device's zone therefore produces a wrong instant instead of passing by coincidence.

**Failing against the unfixed code, confirmed before the fix:**
- `apps/web/tests/event-form-timezone.test.tsx`: a 4 PM Denver event created from Tokyo was stored as
  `07:00Z` (4 PM Tokyo) instead of `22:00Z`. There was no zone picker or label, and the series across
  Nov 1 is covered too. Single-event edit cases were added with the fix.
- `apps/web/tests/notification-times.test.ts` (new block): the reminder and the queued change notice
  for a Denver event on a Pacific team said `PDT` times instead of `4:00 PM – 5:30 PM MDT`.
- `apps/web/tests/series-edit-plan.test.ts` (new block): a Denver series edited from a Pacific device
  treated every occurrence as a reschedule. Also covered: time moves across DST, inserts, a zone change,
  and a legacy DTSTART pin.
- `apps/web/tests/event-timezone.test.ts`: conversions, DST gap and overlap, and expansion across Nov 1
  with an inclusive end date.
- `tests/rls/event-timezone.test.ts`, all 11 cases, run against a reset without the migration:
  - the team default and override on insert
  - an unset zone when the team has none
  - `INVALID_TIMEZONE` refused on insert and on update
  - a team zone change leaving events untouched
  - recording a zone keeping instants
  - a zone change enqueueing `updated` with the zone in the snapshot
  - series inserts taking the series' zone
  - a series zone change keeping ids and local time
- `apps/mobile/__tests__/event-time.test.ts`: new helper, covering the local time with its label, the
  event's day and the arrival time.

**Backfill, checked by hand on the local stack:**
1. Reset without the migration.
2. Seeded events on three teams (Pacific, no zone, and an invalid `"Pacific Time"`), 11 each, past and
   upcoming. The seed data's own team added 5 more.
3. Applied the migration file with `psql`.

Results:
- The Pacific team's events took `America/Los_Angeles`. Events on the teams with no zone or an invalid
  one stayed unset. The seed team's events took `America/New_York`.
- **38 of 38 events kept their exact `start_time` and `end_time`**.
- The backfill enqueued **0** notification jobs.

**Full runs, 2026-09-23:**

| Suite | Result |
| --- | --- |
| `apps/web` Vitest | 954 passed (944 before the review follow-up) |
| Root unit tests run by CI (`tests/unit`, `tests/rrule.test.ts`) | 132 passed |
| `pnpm test:rls` (local stack, clean reset) | 470 passed (469 before) |
| `tests/tenant` + `tests/billing` | 105 passed |
| `apps/mobile` Jest | 48 passed |

`tsc --noEmit` is clean for web and mobile. ESLint reports nothing in changed files.

### Review follow-up (2026-09-23)

The [PR #81 review](../../reviews/2026-09-23-pr81-bug010-review.md) reproduced three edge cases. All three
are fixed, and all four of the review's probes pass unchanged.

1. **The opened occurrence's zone became the series editor's zone.** When the series editor was opened
   from an occurrence moved to another zone, the regular occurrences looked like exceptions and were
   skipped. The series' zone now belongs to the pattern:
   - New rules name it (`DTSTART;TZID=…`), so it survives any single occurrence, the head included,
     moving to another zone.
   - `seriesTimeZone` reads the rule's TZID first, then the head's zone, then the team's or viewer's
     zone. It never reads the opened occurrence's zone.
   - `pinnedStartRule` gives an older rule its TZID from the head's zone *before* the head is edited on
     its own or deleted.
   - A new head rule names the new zone, and a truncated rule keeps the old one.
   - rrule converts a TZID rule's results into the running device's zone. Expansion therefore drops the
     TZID (`expansionOptions`) and keeps working in wall-clock times.
2. **Saving an untouched event in the repeated fall-back hour moved it by an hour.** The editor now keeps
   the stored start and end while the typed time and zone are unchanged. It re-reads a time only after
   the user changes it.
3. **Auckland's daylight-saving changes resolved to the wrong instant.** Sampling offsets twelve hours
   either side did not straddle a change at +12/+13. It now samples 36 hours either side. That covers
   every reading of a wall-clock time, since offsets run from -12 to +14.

One more issue turned up while fixing #2. The editor records a zone on an event from before event zones
when it is saved, and the trigger counted that as a time change. A title-only edit would then have sent
an "updated" notice although nobody's view of the event changed. `20260923000002` counts only a change
from one zone to another. It is a new migration rather than an edit, because staging has already
applied `20260923000001` and applies migrations by version.

Regression tests, all failing before the follow-up:
- `event-timezone.test.ts`:
  - the Auckland spring gap and fall-back overlap
  - a TZID rule expanding in its own zone
  - a Lord Howe half-hour change (a guard; it already passed)
- `series-edit-plan.test.ts`:
  - editing opened from a moved occurrence
  - a head moved on its own
  - a legacy head pinned with its pre-edit zone
  - TZID on the new and truncated rules
- `event-form-timezone.test.tsx`:
  - an untouched save, and an end-only change, in the repeated hour
  - a new series' rule naming its zone
- `tests/rls/event-timezone.test.ts`: recording a first zone enqueues nothing.

**After deploy — required:**
1. **Staging, when the PR's migration run finishes:** `select count(*) from events e join teams t on t.id = e.team_id
   where e.timezone is null and t.timezone in (select name from pg_timezone_names);` returns 0. Check that the result
   of `select count(*) from notification_jobs where created_at > now() - interval '1 hour'` did not jump
   when the migration ran.
2. **Production, after merge:** the same query. Then, as a coach, create an event with the Time zone set
   to a zone other than the team's. It must show that zone's label in the list, the detail page and the
   "new event" email.
3. **Mobile:** the BUG-010 check in [mobile-next.md](../../releases/mobile-next.md), after the held build ships.
   Jest uses Node's `Intl`, not Hermes, so on-device zone formatting is not yet verified.
