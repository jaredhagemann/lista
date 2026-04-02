# Spec: Calendar Export & Subscription

## Overview

Allow team members to access their team schedule outside of Lista in two ways:

1. **One-time `.ics` download** — a snapshot export of all upcoming team events, importable into any calendar app.
2. **Live calendar feed** — a stable URL that calendar apps (Google Calendar, Apple Calendar, Outlook) can subscribe to and poll periodically, keeping their local copy up-to-date as events are added, changed, or cancelled in Lista.

---

## Background

Currently the schedule lives only inside Lista. Members with busy lives (parents, players) want team events to appear alongside their personal calendars without manually checking the app. Coaches and managers want schedule changes to propagate automatically without re-sending notifications every time.

The `.ics` (iCalendar) format is the universal standard for calendar data — supported by every major calendar client. A subscribable feed is a passively-maintained `.ics` URL; the client polls it on its own schedule (typically every few hours) and reflects any changes.

---

## Feature 1: One-Time .ics Download

### What it does

A team member clicks "Download calendar" on the Schedule page and receives a `.ics` file containing all non-cancelled future events for their team.

### API route

```
GET /api/calendar/download
```

- Requires an authenticated session (standard cookie-based auth via the server Supabase client).
- Queries all non-cancelled events for the user's active team, joining `locations` for the venue name and address.
- Returns a response with:
  - `Content-Type: text/calendar`
  - `Content-Disposition: attachment; filename="<team-name>-schedule.ics"`

### .ics event mapping

| iCal field | Source |
|---|---|
| `UID` | `<event.id>@lista` |
| `SUMMARY` | Event title (for games: "vs. `<opponent>`" or "at `<opponent>`" per `home_away`) |
| `DTSTART` | `event.start_time` (UTC) |
| `DTEND` | `event.end_time` (UTC) |
| `LOCATION` | `locations.name` + `locations.address` (comma-separated if both present) |
| `DESCRIPTION` | `event.notes`, plus uniform and arrival time if set |
| `STATUS` | `CONFIRMED` (cancelled events are excluded from the download) |
| `CATEGORIES` | `event.event_type` uppercased (e.g. `GAME`, `PRACTICE`) |

### UI

Add a "Download .ics" button or menu item in the Schedule page header, alongside the existing controls. Admins and members both see it — the feed is scoped to team membership, which is already enforced by RLS on the `events` table.

---

## Feature 2: Subscribable Calendar Feed

### What it does

A stable, team-scoped URL that any calendar app can subscribe to. The calendar app polls it periodically (every few hours) and updates its local copy. Changes made in Lista (new events, cancellations, time changes) propagate automatically without any action from the user.

### Authentication approach: secret token

Standard cookie-based auth does not work for calendar subscriptions — the calendar client (Google Calendar, Apple Calendar etc.) makes unauthenticated HTTP requests without a browser session.

Each team gets a **secret feed token** stored in the `teams` table (`calendar_token UUID NOT NULL DEFAULT gen_random_uuid()`). The feed URL embeds this token:

```
GET /api/calendar/feed/[token]
```

The token acts as a capability — anyone with the URL can read the feed. This is the standard model for calendar subscriptions (Google Calendar, iCloud, etc. all work this way). The practical risk is low:

- Events are not personally identifiable health or financial data.
- Team schedules are already shared broadly within the team.
- Admins can **regenerate** the token at any time (see Token Management below), invalidating all existing subscriptions.

The token is **not** the team UUID — it is a separate random value so that knowledge of the team ID (which appears in many URLs throughout the app) does not grant feed access.

### API route

```
GET /api/calendar/feed/[token]
```

- No auth cookie required.
- Looks up the team by `calendar_token`.
- Returns 404 if the token is not found (no information leak about whether the team exists).
- Returns the full event feed (all events, including cancelled ones as `STATUS:CANCELLED`) with:
  - `Content-Type: text/calendar`
  - `Cache-Control: public, max-age=3600` — hint to clients to re-poll at most every hour.

### .ics feed specifics

The feed format is the same as the download (see mapping table above) with two additions:

- **`STATUS:CANCELLED`** is included for cancelled events rather than excluding them. This tells subscribed calendar clients to remove or strike through the event rather than leaving a stale copy.
- **`SEQUENCE`** is incremented on each meaningful change. Since we don't currently version events in the DB, start with `SEQUENCE:0` for all events and note this as a future improvement if we add an `updated_at` version counter.
- The feed includes a `VCALENDAR` wrapper with:
  - `X-WR-CALNAME:<team-name> Schedule` — sets the calendar display name in most clients.
  - `REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H` — standard hints for a 1-hour refresh cycle.

### Database migration

```sql
ALTER TABLE teams
  ADD COLUMN calendar_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX teams_calendar_token_idx ON teams (calendar_token);
```

The column gets a default so it is populated for all existing teams on migration with no backfill step required.

### Token Management UI

Exposed in the team Settings page (admin-only):

- Display the full feed URL (copyable).
- A "Regenerate" button that issues a new token, invalidating existing subscriptions. Requires confirmation ("Existing subscriptions will stop updating — subscribers will need the new URL").

The regenerate action should be a **Server Action** (using the service role key) to avoid the existing broad UPDATE RLS policy on `teams` allowing non-owners to change the token directly.

### Middleware

Add `/api/calendar/feed/` to the middleware public-route allowlist so unauthenticated calendar clients are not redirected to `/login`.

---

## Shared .ics generation

Both routes share the same iCal serialisation logic. This should live in a single utility:

```
src/lib/calendar/ics.ts
```

Exports a `buildIcs(events, teamName)` function that accepts an array of events (with their joined location) and returns an `iCal` string. No third-party library is needed — the iCal format for this use case is simple enough to generate manually and avoids adding a dependency.

---

## Out of scope

- **Google Calendar API write access** (pushing events to a user's personal Google Calendar via OAuth). The subscribable feed achieves the same end-user outcome (events appear in Google Calendar) without the complexity of OAuth flows, token refresh, per-user write quotas, or Google API credentials.
- **Per-member feeds** (filtered to only events a specific player is involved in). The team-wide feed is sufficient for V1.
- **Recurrence rules** (`RRULE` in iCal). The `events` table has a `recurrence_rule` column but recurrence is not yet a live feature. The feed will expand recurring events as individual `VEVENT` entries (using `parent_event_id` children if they exist) rather than emitting `RRULE`. This is revisited when recurring events are implemented.
- **Webhook-push to Google Calendar** — outside scope; the polling model is sufficient.

---

## Implementation Plan

1. **Migration** — add `calendar_token` column to `teams`.
2. **`src/lib/calendar/ics.ts`** — shared `buildIcs` utility.
3. **`/api/calendar/download`** — authenticated download route.
4. **`/api/calendar/feed/[token]`** — public subscription feed route.
5. **Middleware update** — allowlist `/api/calendar/feed/`.
6. **Settings UI** — feed URL display + regenerate button + Server Action.
7. **Schedule UI** — "Download .ics" button.

---

## Open Questions

1. **Token exposure**: Should the feed URL be visible to all team members (so anyone can subscribe) or admin-only? Leaning toward all members since the events are not sensitive and broad participation is the goal.
2. **Historical events**: Should the download/feed include past events (e.g. last 30 days) or strictly future-only? Including recent past events is useful context in some calendar apps.
3. **Event range**: Should the feed cap at a future horizon (e.g. 12 months) to avoid unbounded queries as teams accumulate years of history?
