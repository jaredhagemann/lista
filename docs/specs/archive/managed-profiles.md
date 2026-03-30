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

## Data Model Changes ✅

### 1. Decouple `profiles.id` from `auth.users` ✅

Added `auth_user_id uuid unique references auth.users(id) on delete cascade` to `profiles`. Existing rows backfilled with `auth_user_id = id`. FK constraint on `id` dropped. Signup trigger updated to set both `id = gen_random_uuid()` and `auth_user_id = new.id`.

### 2. New table: `profile_managers` ✅

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
- Team admins can also view `profile_managers` for members of their team

### 3. New RLS helper function ✅

`is_managed_by_me(p_id uuid)` — checks `profile_managers` for a row where `manager_id` matches the current user.

`is_team_member(t_id uuid)` extended to also return true if any of the user's managed profiles are members of the team.

### 4. Updated RLS policies ✅

| Table | Policy | Change |
|-------|---------|--------|
| `profiles` | Update own profile | Add `OR is_managed_by_me(id)` |
| `profiles` | Select own profile | Add `OR is_managed_by_me(id)` |
| `availability` | Insert own availability | Change to `profile_id = auth.uid() OR is_managed_by_me(profile_id)` |
| `availability` | Update own availability | Same |
| `notification_preferences` | All | Change to `profile_id = auth.uid() OR is_managed_by_me(profile_id)` |
| `team_members` | Insert | Add `OR is_managed_by_me(profile_id)` |

### 5. Active profile selection ✅

The "viewing as" state is **session-based** (stored in a cookie `active_profile_id`, not in the database). The cookie is cleared on sign-out and defaults to the user's own profile on every new login. Readable in any Server Component via `cookies()`, writable only from Server Actions (`src/app/actions/profile.ts`).

If `active_profile_id` is absent or equals the user's own profile ID, the app behaves exactly as before.

---

## Adding Members to a Team

### Single "Add" entry point

On the Team Roster page, admins see a single **"Add"** button. Clicking it opens a small picker with two options:

- **Player** — navigates to the New Member page with role pre-set to `player`
- **Manager** — navigates to the New Member page with role pre-set to `manager`

The old "Add Player" (managed profile) and "Invite Member" (dialog) flows are removed. Invitation is now the **only** way to add anyone to a team.

### New Member page

`/dashboard/team/new-member?role=player|manager`

A full-page form (not a dialog) that mirrors the profile edit view. Fields:
- First name
- Last name
- Email (**required** — the invitation is sent here)
- Birthday
- Gender

The **Invite** button at the bottom sends the invitation email via `/api/invitations/send`. On success, the page shows a confirmation with a copyable invite link (in case email delivery fails) and options to go back to the team or invite another member.

All fields except email are optional — the coach fills in what they know, and the invitee can complete their profile after accepting.

The invitation record stores all provided fields (first name, last name, email, role, birthday, gender) so they can be pre-populated when the invitee accepts.

### New Member page — field requirements

First name and last name are **required** fields on the New Member page. This ensures the identity confirmation step always has a name to display.

### Invitation acceptance flow

When an invitee clicks the **Accept Invitation** link in their email (`/invite/[invitationId]`):

**Already-accepted invitations**

If the invitation has already been accepted, the page shows a message stating it has already been accepted and advises the user to contact their coach if they are unable to log in. No further action is taken.

**Step 1 — Authentication**

The invite link lands on an invite-specific page at `/invite/[invitationId]`. The auth behavior depends on the current session:

- **Not signed in, no account** — redirected to `/invite/[invitationId]/signup`, a dedicated signup page pre-filled with the invitation's first name, last name, and email. Because the invite link itself serves as email verification, no confirmation email is sent.
- **Not signed in, has an account** — prompted to sign in with the invited email address.
- **Signed in with a different email** — signed out automatically and prompted to sign in with the invited email, with a message explaining why.
- **Signed in with the correct email** — proceeds directly to Step 2.

**Step 2 — Identity confirmation (player invitations only)**

For `manager` and `coach` role invitations, this step is skipped — the invitation is accepted directly and the user is added to the team, then redirected to their profile page.

For `player` invitations, the user lands on a confirmation page that asks:

> **Are you [first name] [last name]?**

Two options are presented:

- **"Yes, I am [first name] [last name]"** — the invitation maps directly to the invitee's own profile. No managed profile is created.
- **"No, I am a parent/guardian"** — reveals additional fields:
  - **Relationship** dropdown: Mom / Dad / Guardian
  - **First name** and **Last name** fields for the parent's own profile (pre-filled if the user's profile already has a name)

**Step 3 — Continue → profile page**

Pressing **Continue** on either path:

- **"Yes" path**: accepts the invitation, adds the user to the team with the invited role, applies the birthday and gender from the invitation to the user's own profile, then redirects to their profile page.
- **"Parent/guardian" path**:
  1. Creates a managed profile for the player using the name, birthday, and gender stored on the invitation record.
  2. Links the current user as manager with the chosen relationship.
  3. Adds the managed profile to the team with the invited role.
  4. Updates the current user's own profile with the supplied first/last name.
  5. Redirects to their profile page.

In both cases the invitation is marked as accepted.


## UI: Profile Switcher ✅

A **ProfileSwitcher** component lives in the nav header. It is only shown when multiple profiles (own + managed) share the same active team.

**When viewing as self (default):**
```
[Avatar] Jane Smith ▾
```

**When viewing as a managed profile:**
```
[Avatar] Viewing as: Bryce ▾
```

**Dropdown contents:**
- Each profile on the active team listed with a checkmark on the active one

### What changes when "viewing as" a managed profile ✅

| Feature | Behavior |
|---------|----------|
| Availability page | Shows and updates the managed profile's availability rows |
| Notification prefs (Settings) | Shows and updates the managed profile's `notification_preferences` row |
| Profile tab (Settings) | Shows and edits the managed profile's name, avatar, etc. |
| Schedule / Team / Dashboard | Unchanged — these are team-level views, not profile-scoped |
| Signing out | Always signs out the account holder (the parent), regardless of who they're "viewing as" |

---

## Notifications for Managed Profiles ✅

If a `team_members.profile_id` belongs to a profile with `auth_user_id IS NULL`, the notification fan-out (`/api/notifications/send` and `/api/cron/reminders`) looks up all managers via `profile_managers` and sends to their emails instead. If a profile has multiple managers, all receive the notification. `notification_preferences` for the managed profile controls whether notifications are sent at all.

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
