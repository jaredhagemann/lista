# Events Data Model

## Current Schema

### `events` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | Event identifier |
| `team_id` | uuid | FK → `teams(id)` ON DELETE CASCADE | Owning team |
| `title` | text | NOT NULL | Event name |
| `description` | text | nullable | Optional details |
| `event_type` | text | NOT NULL, CHECK `('practice', 'game', 'other')` | Type of event |
| `location` | text | nullable | Where the event takes place |
| `start_time` | timestamptz | NOT NULL | Event start |
| `end_time` | timestamptz | NOT NULL | Event end |
| `recurrence_rule` | text | nullable | RRULE string for recurring events (weekly/biweekly) |
| `parent_event_id` | uuid | FK → `events(id)` ON DELETE CASCADE, nullable | Links child occurrences to parent for recurring events |
| `is_cancelled` | boolean | default `false` | Soft-cancel flag |
| `created_by` | uuid | FK → `profiles(id)`, nullable | Profile of event creator |
| `created_at` | timestamptz | default `now()` | Row creation timestamp |

### `availability` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | Row identifier |
| `event_id` | uuid | FK → `events(id)` ON DELETE CASCADE, nullable | Related event |
| `profile_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE, nullable | Team member |
| `status` | text | NOT NULL, CHECK `('available', 'unavailable', 'maybe')` | RSVP status |
| `created_at` | timestamptz | default `now()` | Row creation timestamp |

**Unique constraint:** `(event_id, profile_id)` -- one RSVP per member per event.

## RLS Policies

### Events

- **SELECT**: any team member (`is_team_member(team_id)`)
- **INSERT / UPDATE / DELETE**: admins only (`is_team_admin(team_id)`)

### Availability

- **SELECT**: any team member (via join to `events.team_id`)
- **INSERT**: own profile only (`profile_id = auth.uid()`)
- **UPDATE**: own profile only (`profile_id = auth.uid()`)

## Recurrence Model

- Parent event stores an RRULE string in `recurrence_rule` (e.g., `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260401`).
- Child events are expanded at creation time and linked via `parent_event_id`.
- Modifying the parent does **not** retroactively update children.

## Notifications

- **On create/update/cancel**: frontend calls `/api/notifications/send` to fan out emails (Resend) and push notifications (web-push).
- **Daily reminders**: Vercel cron (`/api/cron/reminders`) at 12:00 UTC notifies members about events starting within 24 hours.

---

## Proposed Changes

### 1. Add `locations` table (new)

Team-scoped table for reusable venues/locations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | Location identifier |
| `team_id` | uuid | FK → `teams(id)` ON DELETE CASCADE, NOT NULL | Owning team |
| `name` | text | NOT NULL | Display name (e.g., "Lincoln Park Field 3") |
| `address` | text | nullable | Street address |
| `created_at` | timestamptz | default `now()` | Row creation timestamp |

**Unique constraint:** `(team_id, name)` -- prevent duplicate location names within a team.

**RLS policies:**
- **SELECT**: any team member (`is_team_member(team_id)`)
- **INSERT / UPDATE / DELETE**: admins only (`is_team_admin(team_id)`)

### 2. Modify `events` table

- **Remove** `location` (text) column.
- **Add** `location_id` (uuid, FK → `locations(id)` ON DELETE SET NULL, nullable) -- optional reference to a saved location.
- **Rename** `description` → `notes` -- free-text field for any additional info from a coach/manager.

#### Game-specific fields (nullable, only populated when `event_type = 'game'`)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `opponent` | text | nullable | Opposing team name |
| `home_away` | text | nullable, CHECK `('home', 'away')` | Whether the team is home or away |
| `uniform` | text | nullable, CHECK `('home', 'away')` | Which team uniform to wear; maps to `teams.home_uniform` / `teams.away_uniform` |
| `game_result` | text | nullable, CHECK `('win', 'loss', 'tie')` | Game outcome |
| `score_for` | integer | nullable | Team's score |
| `score_against` | integer | nullable | Opponent's score |
