# Member Model Changes

## Current Schema

### `profiles`
| Column     | Type   | Nullable | Notes                        |
|------------|--------|----------|------------------------------|
| id         | uuid   | no       | PK, matches auth.users.id    |
| full_name  | text   | no       |                              |
| email      | text   | no       |                              |
| phone      | text   | yes      |                              |
| avatar_url | text   | yes      |                              |
| created_at | timestamptz | no  | default now()                |

### `team_members`
| Column       | Type   | Nullable | Notes                                      |
|--------------|--------|----------|--------------------------------------------|
| id           | uuid   | no       | PK                                         |
| team_id      | uuid   | no       | FK → teams.id                              |
| profile_id   | uuid   | no       | FK → profiles.id                           |
| role         | enum   | no       | `coach` · `manager` · `parent` · `player`  |
| jersey_number| int    | yes      |                                            |
| created_at   | timestamptz | no  | default now()                              |

## Proposed Changes

<!-- Describe what you want to change below. Some examples of the kind of things you might document: -->

### `profiles`
- Rename `full_name` → `first_name` (text, not null) — existing `full_name` values become `first_name`
- Add `last_name` (text, not null, default `''`) — empty string default for existing rows
- Add `birthday` (date, nullable)
- Add `gender` (text, nullable)
- Remove `phone` — contact info moves to `contacts` table
- Keep `email` — this is the auth/login email, not a contact field

### `team_members`
- Remove `parent` from the `role` enum — now `coach` · `manager` · `player` only. Parent/guardian info is handled via `contacts`.

### New table: `contacts`
Each profile can have multiple contacts (including a "self" entry for their own contact info).
Linked to `profiles` — contacts are global, shared across all teams.

| Column       | Type        | Nullable | Notes                                          |
|--------------|-------------|----------|-------------------------------------------------|
| id           | uuid        | no       | PK                                             |
| profile_id   | uuid        | no       | FK → profiles.id                               |
| relationship | text        | no       | Free text: "Self", "Mother", "Father", etc.    |
| first_name   | text        | no       |                                                |
| last_name    | text        | no       |                                                |
| email        | text        | yes      |                                                |
| phone        | text        | yes      |                                                |
| street       | text        | yes      |                                                |
| city         | text        | yes      |                                                |
| state        | text        | yes      |                                                |
| zip          | text        | yes      |                                                |
| receives_email | boolean   | no       | default true — whether this contact gets team emails |
| created_at   | timestamptz | no       | default now()                                  |

## Migration Notes
- Rename `profiles.full_name` → `profiles.first_name` (simple column rename, existing values stay)
- Add `profiles.last_name` with default `''` for existing rows
- For existing profiles that have a `phone` value, create a "Self" contact row with that phone before dropping the column
- RLS on `contacts`: same pattern as other profile-owned data — users can read/write their own contacts, team members can read contacts of teammates (via `team_members` join)

## Affected Areas
- **Profile form** (`src/components/settings/profile-form.tsx`) — split full_name into first/last, add birthday/gender, remove phone
- **Contacts UI** (future) — new component to manage contacts per profile
- **Team roster** (`src/app/dashboard/team/page.tsx`) — display names from first_name + last_name
- **Invite flow** — may need updates for name field changes
- **Database types** (`src/types/database.ts`) — regenerate after migration
- **RLS policies** — add policies for new `contacts` table
- **Notification routes** — update any queries that reference `full_name` or `phone`
