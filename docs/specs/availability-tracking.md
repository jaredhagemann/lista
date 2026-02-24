# Availability Tracking

## Overview

Allow every team member to mark their availability for each event using a three-state response: **Available / Maybe / Unavailable**. Responses are stored per user per event, visible to all team members, and surfaced in two places: on each event's detail page, and on a dedicated availability page that shows a full matrix of members × events.

---

## Current State

The `availability` table already exists in the database with the following schema:

```sql
create table availability (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  status text not null check (status in ('available', 'unavailable', 'maybe')),
  created_at timestamptz default now(),
  unique(event_id, profile_id)
);
```

RLS policies are already in place:
- **SELECT**: visible to any team member for their team's events
- **INSERT**: users can only insert rows where `profile_id = auth.uid()`
- **UPDATE**: users can only update their own rows

RLS integration tests exist at `tests/rls/availability.test.ts`.

**What's missing**: all UI — no components, no pages, no data-fetching code.

---

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Status vocabulary | Use DB values as-is: `available` / `unavailable` / `maybe` displayed as "Available" / "Unavailable" / "Maybe" |
| 2 | Show non-responders on event detail | Yes — show all team members including those with no response |
| 3 | Availability page access | Visible to all roles |
| 4 | Cross-member visibility | All members can see all other members' responses |
| 5 | Admin override | Coaches and managers can set availability on behalf of any member |
| 6 | Nav placement | Top-level nav item alongside Schedule and Team |
| 7 | Schedule list indicator | Out of scope for v1 |
| 8 | Recurring events | Availability is per-occurrence only, never series-wide |
| 9 | Post-event cutoff | RSVP buttons are hidden once an event's start time has passed |
| 10 | Mobile matrix | Horizontal scroll is acceptable; revisit later if needed |

---

## Data Model

No schema changes needed. The existing table and RLS policies are sufficient with one addition: coaches/managers need the ability to upsert availability for *other* members, which the current `INSERT`/`UPDATE` policies block (`profile_id = auth.uid()`).

### Required migration: admin availability override policy

Add a new RLS policy permitting team admins to insert/update any member's availability for their team's events:

```sql
create policy "Admins manage team availability"
  on availability for all using (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  ) with check (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  );
```

Also need a `DELETE` policy for clearing responses (currently no delete policy exists):

```sql
create policy "Users delete own availability"
  on availability for delete using (profile_id = auth.uid());

create policy "Admins delete team availability"
  on availability for delete using (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  );
```

### Status values

| DB value | Display label | Color |
|---|---|---|
| `available` | Available | Green |
| `maybe` | Maybe | Amber |
| `unavailable` | Unavailable | Red |
| *(no row)* | No response | Muted/grey |

---

## Feature Areas

### 1. Event detail page — RSVP + response list

Added below the existing event detail card. Shown to all team members. RSVP buttons hidden for cancelled events and past events (start time already passed).

**Current user's RSVP** (always shows their own status, regardless of role):

```
┌──────────────────────────────────────┐
│ Your availability                    │
│  [✓ Available]  [Maybe]  [Unavailable]│
└──────────────────────────────────────┘
```

Clicking the active button clears the response (DELETE row). Clicking a different button upserts.

**Admin RSVP on behalf of another member**: Coaches/managers see a "Set availability" control for each member who hasn't responded (or can override existing responses), accessible via a small dropdown or inline control in the response list.

**Team response list** (all members, grouped by status):

```
┌────────────────────────────────────────────────┐
│ Responses  · 12 available · 2 maybe · 1 unavailable │
│                                                │
│ Available (12)                                 │
│  Alex M.  Jordan K.  Sam P.  …                │
│ Maybe (2)                                      │
│  Riley B.  Casey T.                           │
│ Unavailable (1)                               │
│  Taylor W.                                     │
│ No response (4)                               │
│  Morgan L.  Drew H.  …                        │
└────────────────────────────────────────────────┘
```

For non-admin members, all entries in the response list are read-only. For admins, each member's row has an inline status selector (or the admin's own "Set for member" dropdown).

### 2. Availability page — full matrix

New page at `/dashboard/availability`. Added as a top-level nav item with a `CheckSquare` or `ClipboardList` icon, between Schedule and Team.

**Server RSC** fetches:
- All team members (with profile names)
- All upcoming events for the team (start_time >= now, ordered chronologically)
- All availability rows for those events

**Layout**:

```
Availability

[Upcoming ▾]  [All types ▾]

              | Mar 4    | Mar 6    | Mar 11   | Mar 13   |
              | Tue      | Thu      | Tue      | Thu      |
              | Practice | Practice | Game     | Practice |
──────────────┼──────────┼──────────┼──────────┼──────────┤
Alex M.       | Avail.   | Avail.   | Maybe    |          |
Jordan K.     | Avail.   |          | Avail.   | Unavail. |
Sam P.        | Maybe    | Avail.   | Avail.   | Avail.   |
Riley B.      |          | Unavail. | Avail.   | Avail.   |
```

**Column headers**: event date (short), day of week, event type badge. Clicking a column header navigates to that event's detail page.

**Cells**:
- Current user's cells: interactive — clicking cycles Available → Maybe → Unavailable → (clear), or opens a small popover with the three choices
- Admin viewing another member's row: cells show a dropdown to override that member's status
- All other cells: read-only badge/chip

**Filters**:
- **Upcoming / All** toggle (default: upcoming)
- **Event type** filter (all / practice / game / other)
- Date range not needed for v1

**Empty state**: "No upcoming events" with a link to the schedule.

**Horizontal scroll**: The table scrolls horizontally on narrow screens. Member name column is sticky (position: sticky left).

### 3. Schedule list — response indicator

Out of scope for v1.

---

## Data Fetching Strategy

### Event detail page

The event detail page is a server RSC. Extend it to also fetch:
- All `availability` rows for this event (with `profile_id`)
- All `team_members` with profile names (to show "no response" members)

Pass both down to `EventDetail` as props. The client component handles mutations (upsert/delete) and optimistic UI.

```ts
// In page.tsx
const { data: availabilityRows } = await supabase
  .from("availability")
  .select("profile_id, status")
  .eq("event_id", eventId);

const { data: members } = await supabase
  .from("team_members")
  .select("profile_id, profiles(first_name, last_name)")
  .eq("team_id", event.team_id);
```

### Availability page

```ts
// In page.tsx — all in parallel
const [events, members, availabilityRows] = await Promise.all([
  supabase.from("events")
    .select("id, title, event_type, start_time")
    .eq("team_id", teamId)
    .gte("start_time", new Date().toISOString())
    .order("start_time"),
  supabase.from("team_members")
    .select("profile_id, profiles(first_name, last_name)")
    .eq("team_id", teamId),
  supabase.from("availability")
    .select("event_id, profile_id, status")
    .in("event_id", upcomingEventIds),
]);
```

Build a `Map<eventId, Map<profileId, status>>` lookup in the component for O(1) cell rendering.

### Mutations (client-side, all pages)

```ts
// Upsert (insert or update)
await supabase.from("availability").upsert(
  { event_id, profile_id, status },
  { onConflict: "event_id,profile_id" }
);

// Clear response
await supabase.from("availability")
  .delete()
  .eq("event_id", event_id)
  .eq("profile_id", profile_id);
```

Optimistic updates: update local state immediately, roll back on error.

---

## RLS Summary

| Operation | Who | Policy |
|---|---|---|
| SELECT | Any team member | Existing: "Availability visible to team" |
| INSERT own | Any member | Existing: "Users manage own availability" |
| UPDATE own | Any member | Existing: "Users update own availability" |
| INSERT/UPDATE any | Coach/manager | **New**: "Admins manage team availability" |
| DELETE own | Any member | **New**: "Users delete own availability" |
| DELETE any | Coach/manager | **New**: "Admins delete team availability" |

---

## Files to Create / Modify

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDDXXXXXX_availability_policies.sql` | New migration: admin override + delete policies |
| `src/app/dashboard/availability/page.tsx` | New page — server RSC |
| `src/components/availability/availability-matrix.tsx` | New — full interactive matrix table |
| `src/components/availability/rsvp-buttons.tsx` | New — Available/Maybe/Unavailable toggle for current user |
| `src/components/availability/response-list.tsx` | New — grouped response list for event detail |
| `src/app/dashboard/schedule/[eventId]/page.tsx` | Fetch availability + members, pass to EventDetail |
| `src/components/calendar/event-detail.tsx` | Add RsvpButtons + ResponseList below event card |
| `src/components/layout/dashboard-nav.tsx` | Add Availability nav item |
| `tests/rls/availability.test.ts` | Extend with delete + admin override test cases |

---

## Implementation Order

1. **Migration** — add delete + admin RLS policies
2. **RsvpButtons** — self-contained RSVP toggle component
3. **ResponseList** — grouped list component for event detail
4. **Event detail page** — wire up server fetch + render both new components
5. **Availability page + matrix** — server RSC + interactive matrix component
6. **Nav** — add Availability link
7. **Tests** — extend RLS tests for new policies
