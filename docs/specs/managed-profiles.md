# Managed Profiles

## Problem

The current system assumes a 1:1 relationship between an email address and a player profile. This breaks down in two real scenarios:

1. **Parent with multiple children on the same team** — e.g. twins. Two player entries are needed for availability, roster, and notifications, but the parent only has one login.
2. **Parent who is also a coach** — they appear on the roster twice (once as coach, once their child appears as a player), but log in once.

---

## Scenarios Covered

| Who | Role on team | Child on team? | Current problem |
|-----|-------------|----------------|-----------------|
| Parent of twins | None / spectator | 2 players | Can't create 2 player entries with 1 email |
| Coach-parent | Coach | 1 player | Coach entry exists; no way to also track child |
| Grandparent managing a player | None | 1 player | Same as above — 1 email, 1 managed profile |

---

## Core Concept: Managed Profiles

A **managed profile** is a `profiles` row that has no corresponding `auth.users` entry — it cannot log in. It represents a player (typically a child) and is linked to one or more guardian accounts via a new `profile_managers` table.

A user who manages profiles sees a **Profile Switcher** in the nav (similar to the Team Switcher). When "viewing as" a managed profile, availability, notification preferences, and profile info are all scoped to that profile. The managing parent's login session is unchanged.

---

## Data Model Changes

### 1. Decouple `profiles.id` from `auth.users`

**Current:**
```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  ...
);
```

The `id` column is both the primary key and a hard FK to `auth.users`. This prevents creating profiles without auth accounts.

**Proposed:**
```sql
-- Add a separate column for the auth link (nullable for managed profiles)
alter table profiles
  add column auth_user_id uuid unique references auth.users(id) on delete cascade;

-- Backfill: for all existing profiles, auth_user_id = id
update profiles set auth_user_id = id;

-- Drop the FK constraint on id (keep as primary key, now a free UUID)
alter table profiles drop constraint profiles_id_fkey;
```

The signup trigger is updated to set `auth_user_id = new.id` (and generate a fresh `gen_random_uuid()` for `id`), keeping the cascade delete behavior via `auth_user_id`.

> **Note:** This is the largest migration in the set. All RLS policies that currently use `id = auth.uid()` must be updated to use `auth_user_id = auth.uid()`. The helper functions `is_team_member` and `is_team_admin` are unchanged since they work off `team_members.profile_id`, not `auth.uid()` directly.

### 2. New table: `profile_managers`

```sql
create table profile_managers (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references profiles(id) on delete cascade,
  managed_id  uuid not null references profiles(id) on delete cascade,
  relationship text, -- e.g. "parent", "guardian" (optional, display only)
  created_at timestamptz default now(),
  unique(manager_id, managed_id)
);
```

RLS on `profile_managers`:
- A user can select their own rows (`manager_id = auth.uid()` via `auth_user_id`)
- A user can insert rows where they are the manager
- Team admins can also view `profile_managers` for members of their team (needed to display relationships on the roster)

### 3. New RLS helper function

```sql
create or replace function is_managed_by_me(p_id uuid)
returns boolean as $$
  select exists (
    select 1 from profile_managers pm
    join profiles mgr on mgr.id = pm.manager_id
    where mgr.auth_user_id = auth.uid()
    and pm.managed_id = p_id
  )
$$ language sql security definer;
```

### 4. Updated RLS policies

| Table | Policy | Change |
|-------|---------|--------|
| `profiles` | Update own profile | Add `OR is_managed_by_me(id)` |
| `profiles` | Select own profile | Add `OR is_managed_by_me(id)` |
| `availability` | Insert own availability | Change to `profile_id = auth.uid() OR is_managed_by_me(profile_id)` |
| `availability` | Update own availability | Same |
| `notification_preferences` | All | Change to `profile_id = auth.uid() OR is_managed_by_me(profile_id)` |

`team_members` INSERT policy already allows `profile_id = auth.uid()` — extend to also allow inserting a managed profile: `OR is_managed_by_me(profile_id)`.

### 5. Active profile selection

The "viewing as" state is **session-based** (stored in a cookie, not in the database). Rationale: a parent should always start a session viewing as themselves — being silently locked into a child's view across devices is a footgun. The cookie is cleared on sign-out and defaults to the user's own profile on every new login.

The cookie `active_profile_id` follows the same read/write pattern as the active team approach: readable in any Server Component via `cookies()`, writable only from Server Actions.

If `active_profile_id` is absent or equals the user's own profile ID, the app behaves exactly as today.

---

## Creating Managed Profiles

### Path 1 — Team admin adds a player directly (no invite required)

On the Team Roster page, admins get an **"Add player"** option alongside the existing "Invite member" button. This opens a form that collects:
- First name, last name
- Optional email (contact reference only, not used for login)
- Role (defaults to player)
- Optional: link to an existing account holder as manager (search by name/email)

The admin creates the profile and adds it to the team in one action. No email is sent unless an email address is provided, in which case a notification is optionally sent to the listed contact.

### Path 2 — Parent adds a managed profile from their account

Under **Settings → Managed Players**, a logged-in user can:
1. Create a new managed profile (name, optional email/birthday/etc.)
2. See all profiles they currently manage
3. Add an existing managed profile to a team they're a member of (generates an invite-style team_member insert)
4. Remove themselves as manager of a profile

This path is useful for parents who want to set things up before their child's team admin has even sent them an invite.

---

## UI: Profile Switcher

A new **ProfileSwitcher** component lives in the nav header, positioned to the left of the existing Team Switcher. It mirrors the Team Switcher's dropdown pattern.

**When viewing as self (default):**
```
[Avatar] Jane Smith ▾
```

**When viewing as a managed profile:**
```
[Avatar] Viewing as: Bryce ▾      ← amber/warning color to make it obvious
```

**Dropdown contents:**
- Own name + role at the top, with a checkmark when active
- Each managed profile listed with their name and relationship label
- "Manage players" link at the bottom → Settings → Managed Players

**Visibility:** The ProfileSwitcher is only rendered if the user has at least one managed profile. Users with no managed profiles see no change to the nav.

### What changes when "viewing as" a managed profile

| Feature | Behavior |
|---------|----------|
| Availability page | Shows and updates the managed profile's availability rows |
| Notification prefs (Settings) | Shows and updates the managed profile's `notification_preferences` row |
| Profile tab (Settings) | Shows and edits the managed profile's name, avatar, etc. |
| Schedule / Team / Dashboard | Unchanged — these are team-level views, not profile-scoped |
| Signing out | Always signs out the account holder (the parent), regardless of who they're "viewing as" |

---

## Notifications for Managed Profiles

The notification send path (`/api/notifications/send` and `/api/cron/reminders`) currently looks up `profile.email` for each team member. With managed profiles:

- If a `team_members.profile_id` belongs to a profile with `auth_user_id IS NULL` (a managed profile), look up the manager's email via `profile_managers` and send there instead.
- If a profile has multiple managers, send to the first manager found (or all — TBD, likely all).
- `notification_preferences` for the managed profile controls whether the email is sent at all (the parent can disable notifications for a child's profile independently of their own).

This means a parent with twins on the same team receives **two separate emails** per event (one per child), both delivered to their inbox. This is intentional — each email is about a specific child and their availability/context.

---

## Account Upgrade Path (future, not built now)

The data model is designed to support future account upgrades without breaking existing data:

1. A managed profile may have an `email` stored on the `profiles` row (optional).
2. When a new user signs up with an email that matches a managed profile's email, the system detects the match and offers to link the new auth account to the existing profile (setting `auth_user_id` on the managed profile row).
3. The `profile_managers` relationship is preserved — the parent remains a manager unless explicitly removed.
4. No data migration is needed for availability, team_members, or notification_preferences — they all reference `profile_id`, which doesn't change.

---

## Out of Scope (for now)

- **Multiple managers per managed profile** — the data model supports it (no unique constraint on `managed_id`), but the UI only assigns one manager at creation time.
- **Manager notifications** — notifying a manager when their child's availability is changed by an admin.
- **Managed profiles across organizations** — fully supported by the data model (managed profiles are global, not team-scoped), but no cross-org UI is needed.
- **Removing a player profile from a team** — handled by existing team_member delete, no change needed.
