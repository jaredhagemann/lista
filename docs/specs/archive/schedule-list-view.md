# Schedule List View

## Overview

Add a list view to the existing `/dashboard/schedule` page as a second tab alongside the current month calendar view. The list view shows all team events in chronological order, filterable and paginated, with admin actions accessible via a row-level menu.

---

## Navigation & Layout

- The schedule page gains two tabs: **Calendar** (existing) and **List** (new).
- Tab state is local component state (no URL persistence).
- Default view is **List**.

---

## Data Scope

### Default state: upcoming events
- On load, the list shows events with `start_time >= today (start of day, local time)`.
- A toggle — **Upcoming / All** — lets the user switch to all events (past + future), sorted oldest → newest when viewing all, newest → oldest would be confusing; keep chronological (ascending) always.

### Cancelled events
- Included in the list by default, but rendered with a visual cancelled indicator (e.g. a "Cancelled" badge and muted/strikethrough title text).
- They are **not** filtered out by any default filter.

### Recurring events
- Each occurrence is listed as its own independent row. No grouping or collapsing.

---

## Columns

| Column | Notes |
|---|---|
| **Title** | For `practice` and `other` events: the event title. For `game` events: the game details used as the title — format `Home vs Rival FC` or `Away @ Rival FC`; if a score exists, append it: `Home vs Rival FC · 3–1`. Muted + strikethrough if cancelled. Clicking navigates to event detail page. |
| **Type** | Badge: `Practice` / `Game` / `Other`. Color-coded to match the calendar dots (blue / red / purple). |
| **Date** | e.g. `Wed, Mar 4` |
| **Time** | e.g. `4:00 – 5:00 PM`. If arrival time is set, show it below in muted text: `Arrive by 3:45 PM`. |
| **Location** | Location name, or `—` if none. |
| **Actions** | `...` icon button, visible only to coaches and managers (admins). See [Admin Actions](#admin-actions) below. |

> **Column visibility on mobile:** On small screens, collapse to Title + Type + Date/Time only. Location can be hidden. The actions button remains visible.

---

## Filtering

A filter bar sits above the table with the following controls:

### Event type filter
- A segmented control or set of toggle buttons: **All** · **Game** · **Practice** · **Other**
- Default: **All**
- Filters are applied client-side (data is already fetched for the current page window).

### Past / Upcoming toggle
- **Upcoming** (default): `start_time >= start of today`
- **All**: no date constraint

---

## Pagination

- Default page size: **30 events**.
- A **"Rows per page"** dropdown in the table footer offers: `30 / 50 / 100`.
- Simple previous / next page controls (no infinite scroll).
- Page resets to 1 whenever a filter or the upcoming/all toggle changes.
- Pagination is server-side: only the current page window is fetched from Supabase, ordered by `start_time ASC`.

---

## Admin Actions (`...` menu)

The actions column is rendered only when `isAdmin = true` (role is `coach` or `manager`). Each row shows a `...` (`MoreHorizontal`) icon button that opens a dropdown with:

| Action | Behaviour |
|---|---|
| **Edit** | Opens the existing `EventFormDialog` pre-populated with the event's data (same as the edit button on the detail page). |
| **Duplicate** | Creates a new event with the same `start_time`, `end_time`, title, type, location, arrival time, notes, and game fields (opponent, home/away, uniform). Does not copy `game_result`, `score_for`, `score_against`, `recurrence_rule`, or `parent_event_id`. Shows a success toast on completion. |
| **Delete** | Shows a confirmation dialog (same pattern as the detail page delete). Deletes the event and removes the row from the list. |

---

## Empty States

- **No upcoming events:** "No upcoming events. [Create one ↗]" (link to open the create dialog; shown only to admins).
- **No results for current filter:** "No [type] events found." with a button to clear the filter.
- **No events at all:** "No events scheduled yet."

---

## Implementation Notes

### Data fetching
- Server component (`schedule/page.tsx`) currently fetches all events and passes them to the calendar. The list view needs paginated, filtered fetches — these should be driven from a client component using the browser Supabase client, separate from the calendar's existing server-side fetch.
- The two views (calendar, list) can share the same top-level RSC shell but each manages its own data independently.

### State management
- All filter state (type filter, upcoming/all toggle, page, page size) lives in local component state inside `schedule-list.tsx`. Nothing is persisted to the URL.

### Component location
- New file: `src/components/calendar/schedule-list.tsx`
- Duplicate logic can live inline or in a small helper in `src/lib/events.ts` if reuse is needed.

---

## Decisions Log

| Question | Decision |
|---|---|
| Duplicate offset | Same date/time as original (no offset). User can edit afterwards. |
| Duplicate + recurring series | Duplicate produces a single standalone event — no `recurrence_rule` or `parent_event_id` copied. |
| Filter/pagination URL persistence | Local component state only. |
