# Spec: Team Deletion

## Overview

Allow a team to be permanently deleted, removing all associated data. This feature introduces the concept of a **team owner** - a distinct role above coach/manager that has exclusive authority to delete a team.

---

## Background

Currently the system has three roles: `coach`, `manager`, and `player`. Coaches and managers are treated identically as admins. There is no ownership concept - no single user is distinguished as the team creator or ultimate authority.

Deletion is a destructive, irreversible action. Allowing any coach or manager to delete a team (which another coach may have created and others depend on) is too permissive. A dedicated owner role scopes this capability to one accountable person per team.

---

## New Concept: Team Owner

A **team owner** is the single user who has ultimate authority over the team, including the ability to delete it. There is exactly one owner per team at any given time.

### Implementation

Add an `owner_id` column to the `teams` table referencing `profiles(id)`. This is simpler than a new role value and avoids ambiguity about what other capabilities "owner" might imply.

- The user who creates the team becomes the first owner automatically.
- The owner is always implicitly a team admin (coach/manager) as well - they must hold a `coach` or `manager` `team_members` row in addition to being the owner.
- The owner must always remain a current admin member until ownership is transferred. The system must not allow the current owner to end up as a non-member or non-admin while still referenced by `teams.owner_id`.
- Ownership can be transferred to any current team admin (coach or manager). Ownership cannot be transferred to a player.
- **`owner_id` must always reference a profile with a real auth account** (`profiles.auth_user_id IS NOT NULL`). Managed/no-auth profiles must never become team owners, even if the data is in an unexpected state. This is enforced by a database trigger (see Ownership Transfer) and redundantly validated in the server action before any ownership assignment or transfer.
- **Ownership transfer is in scope at launch** - it is a prerequisite for the owner-removal guardrail described below.
- The owner is **visible to all team members** (e.g., labeled "Team Owner" on the roster page).

### Owner Self-Removal Guardrail

The owner **cannot remove themselves from the team** without first transferring ownership to another admin. If they attempt to leave (via the roster management UI), they will be blocked with a prompt to transfer ownership first.

More generally, the current owner cannot be removed from the team at all while they are still the owner, whether the removal is initiated by themselves or by another admin. Any removal flow that would delete or downgrade the current owner's admin membership must first require an ownership transfer.

---

## Ownership Transfer

Ownership transfer is performed exclusively via a **Server Action using the service role key**, mirroring the deletion model. There is no direct RLS path for updating `owner_id`.

This is necessary for two reasons:

1. **The existing UPDATE RLS policy on `teams` grants all admins broad write access** (`is_team_admin(id)` with no column restriction). If `owner_id` were updatable via the normal client path, any coach or manager could overwrite it directly — bypassing the owner-only gate entirely.
2. **Complex validation is required** (recipient must be a current admin with `auth_user_id IS NOT NULL`) that cannot be expressed in an RLS policy.

A single **`BEFORE INSERT OR UPDATE OF owner_id` trigger on `teams`** enforces both constraints:

1. **Blocks direct client writes** — rejects any `owner_id` change originating from a non-service-role session, ensuring the server action is the only path (consistent with how deletion is enforced).
2. **Enforces auth-backed profile** — looks up `profiles.auth_user_id` for the incoming `NEW.owner_id` and raises an exception if it is `NULL`.

A `CHECK` constraint cannot do this — it can only inspect columns on the same row. There is also no viable FK chain from `teams.owner_id` (which references `profiles(id)`) to `auth.users` that would enforce `auth_user_id IS NOT NULL`. The trigger is the only DB-level mechanism that can cross the `teams → profiles` join to enforce this invariant.

The server action is responsible for:

1. Verifying the requesting user is the current team owner.
2. Verifying the recipient is a current `coach` or `manager` member of the team with `auth_user_id IS NOT NULL`.
3. Updating `teams.owner_id` to the recipient's `profile_id` (service role).

The owner can initiate transfer from the Team Settings page. Managed profiles never appear as transfer candidates.

The flow:

1. In Team Settings, an "Ownership" section (visible only to the owner) lists current admins eligible for transfer (auth-backed only) and a "Transfer Ownership" action.
2. The owner selects a recipient and confirms via a dialog.
3. The server action runs the checks above and updates `teams.owner_id`.
4. The previous owner retains their coach/manager membership - they are not removed from the team.

---

## Deletion Behavior

### What Gets Deleted

Team deletion is **permanent and unrecoverable**. The following data is removed:

| Data | Mechanism |
|---|---|
| Team record | Direct DELETE |
| Team members (all roles) | `ON DELETE CASCADE` (already in schema) |
| Events (all past and future) | `ON DELETE CASCADE` (already in schema) |
| Availability responses | `ON DELETE CASCADE` via events |
| Invitations (pending) | `ON DELETE CASCADE` (already in schema) |
| Locations | `ON DELETE CASCADE` (already in schema) |
| Chat channels | `ON DELETE CASCADE` (already in schema) |
| Channel members | `ON DELETE CASCADE` via channels |
| Chat messages | `ON DELETE CASCADE` via channels |
| DM channels | `ON DELETE CASCADE` (already in schema) |
| DM messages | `ON DELETE CASCADE` via DM channels |
| `profiles.active_team_id` | Set to NULL via `ON DELETE SET NULL` (already in schema) |
| Team images (logo, team photo) | Explicit deletion in server action — see note below |

> **Storage objects are not cascade-deleted.** Team images live in the `team-images` storage bucket under the path `{team_id}/`. Deleting the `teams` row leaves these objects orphaned: the RLS policies on `storage.objects` use `is_team_admin` / `is_team_member` to gate access, so once the team and its members are gone the objects become permanently inaccessible but are never removed. The server action must explicitly list and delete all objects under the `team-images/{team_id}/` prefix (using the service role client) **before** executing the team DELETE.

> **Note:** `push_subscriptions` and `notification_preferences` are not scoped to a team and are not affected.

### What Is NOT Deleted

- User profile accounts - members continue to exist as users, they just lose membership on this team.
- Other teams the members belong to - only this team is affected.
- The organization record - the org persists even if all its teams are deleted.

---

## Member Notifications on Deletion

Before the team is deleted, **all current team members receive a notification** informing them the team has been deleted. This is purely informational - the deletion is immediate and cannot be undone.

The notification should include:
- Team name
- A message that the team has been permanently deleted by the team owner
- No action link (there is nothing to act on)

Notifications should reuse the existing notification infrastructure (email via Resend + push via web-push) and respect each member's notification preferences, but they should be dispatched through a **dedicated team-deletion notification helper/action**, not the existing event-specific `/api/notifications/send` route.

The notification fan-out must be attempted **before** the DELETE is executed, since the member records are needed to determine recipients.

### Managed profile routing

Not all team members have auth accounts. The fan-out must handle this explicitly, following the same pattern used in `/api/notifications/send`:

- **Auth-backed members** (`auth_user_id IS NOT NULL`): notify directly via email and push using the member's own profile email and `push_subscriptions`.
- **Managed members** (`auth_user_id IS NULL`): they have no email address of their own and no push subscriptions. Instead, look up their managers via `profile_managers` and send email to each manager. Push notifications are skipped for managed profiles.
- **Notification preferences**: checked against the managed profile's own `profile_id` (consistent with the existing pattern). If no preference row exists, default to enabled.
- A managed player may have multiple managers; all should receive the email.

### Partial failure handling

Best-effort dispatch with logging. Notification delivery is inherently unreliable (invalid push tokens, provider outages, rate limits). The server action should attempt delivery to all recipients, log any per-recipient failures for observability, and then proceed with deletion regardless of delivery outcomes. Aborting the deletion on a failed send is wrong — the notifications are purely informational, some recipients may have already been notified before the failure, and leaving the team un-deleted because of a stale push subscription would be a broken UX. A transactional job queue would be the theoretically ideal mechanism, but this codebase has no such infrastructure and the informational nature of the notification does not justify introducing one.

---

## Access Control

Only the **team owner** may delete a team.

- Coaches and managers who are not the owner cannot delete the team.
- Players cannot delete the team.
- Unauthenticated users cannot delete the team.

### Implementation Notes

Deletion is performed exclusively via a **Server Action using the service role key**. There is intentionally **no RLS DELETE policy** on the `teams` table — direct client-side deletes are blocked for all users.

This is the only viable approach given the notification requirement: the server action must fetch all current members and dispatch notifications *before* executing the DELETE (member records are gone after). An RLS-based client delete would allow the client to bypass that step.

The server action is responsible for:

1. Verifying the requesting user is the team owner.
2. Fetching all current team members.
3. Dispatching deletion notifications to all members.
4. Deleting all objects under the `team-images/{team_id}/` prefix in Supabase Storage (service role).
5. Executing the DELETE on the `teams` table (cascades handle the rest).

---

## UX

### Team Owner Display

On the **Roster page** (`/dashboard/team`), the owner's entry is labeled "Team Owner" (in addition to their role). This is visible to all team members.

### Ownership Transfer Entry Point

In **Team Settings** (`/dashboard/settings`), an "Ownership" section is visible only to the current owner. It shows the current owner and a "Transfer Ownership" button that opens a dialog to select a recipient from the list of current admins.

### Deletion Entry Point

A "Delete Team" option in **Team Settings** (`/dashboard/settings`), in a clearly separated "Danger Zone" section at the bottom. Visible only to the team owner.

### Deletion Confirmation Flow

1. Clicking "Delete Team" opens a modal/dialog.
2. The dialog explains the action is permanent and lists what will be deleted (all members, events, chat history, etc.).
3. The user must type the **team name** to confirm.
4. A final "Permanently Delete" button submits the action.

### Post-Deletion UX

After deletion:

- The owner is redirected to `/dashboard`.
- Other members who are mid-session on this team's dashboard are **not notified in real-time**. On their next navigation or page load, the app's existing fallback logic in `getActiveMembership()` handles the null `active_team_id`:
  - If they have other team memberships, the app silently switches to their next available team.
  - If this was their only team, the dashboard home page shows the "Welcome to lista - create or join a team" blank state.
- No explicit real-time handling is required; the existing fallback behavior is sufficient.

---

## Open Questions

| # | Question | Status |
|---|---|---|
| Q1 | Is ownership transfer in scope at launch? | **Yes** - required for the owner self-removal guardrail |
| Q2 | What happens when the owner tries to leave without transferring ownership? | **Block self-removal** until they transfer ownership first |
| Q3 | Should team owner be visible to other members? | **Yes** - labeled on the roster |
| Q4 | How are mid-session members handled when their active team is deleted? | **No explicit handling needed** - existing `getActiveMembership()` fallback covers both cases (other teams available -> silent switch; no teams -> blank state) |
| Q5 | Soft-delete / grace period or instant permanent deletion? | **Instant and permanent** |
| Q6 | Notify members on deletion? | **Yes** - informational notification sent to all members before data is wiped |
| Q7 | Billing/subscription implications? | No billing system currently - not applicable |

---

## Test Plan

Tests span three layers matching the existing project conventions: **RLS integration tests** (hit a real local Supabase instance), **unit tests** (pure logic, no DB), and **E2E tests** (Playwright, full browser flow).

---

### 1. RLS Tests - `tests/rls/teams.test.ts` (additions)

These test the new `owner_id` column and DELETE policy directly against the database.

**`owner_id` - schema and visibility**
- `createTestTeam` helper sets `owner_id` - verify the column is present and populated on the created team row (via `adminClient`)
- Team owner can SELECT their own `owner_id`
- Non-owner team member (coach, manager, player) can SELECT `owner_id` (visible to all members per spec)
- Non-member cannot SELECT `owner_id` (blocked by existing SELECT policy)

**`owner_id` - direct client UPDATE blocked (no RLS path)**
- Team owner cannot UPDATE `owner_id` directly via the Supabase client (blocked by DB trigger) — confirms transfer is locked to the server action path
- Non-owner admin cannot UPDATE `owner_id` directly via the Supabase client
- Player cannot UPDATE `owner_id` directly via the Supabase client

> These tests verify the *absence* of a direct client UPDATE path for `owner_id`, consistent with the deletion model. Authorization logic and validation (owner-only, auth-backed recipient) live in the server action and are tested in section 4.

**No RLS DELETE policy — direct client deletes blocked**
- Team owner cannot DELETE their team directly via the Supabase client (zero rows affected, team still exists) — confirms deletion is locked to the server action path
- Non-owner admin cannot DELETE a team directly via the Supabase client
- Player cannot DELETE a team directly via the Supabase client

> These tests verify the *absence* of a DELETE policy. Authorization logic (owner-only gate) lives in the server action and is tested in section 4.

---

### 2. RLS Tests - `tests/rls/teams.test.ts` (cascade verification)

These verify that a team DELETE cleans up all associated data. Each test creates the data, deletes the team via `adminClient`, then asserts the child rows are gone.

- Deleting a team removes all `team_members` rows
- Deleting a team removes all `events` rows
- Deleting a team removes `availability` rows (via events cascade)
- Deleting a team removes all `invitations` rows
- Deleting a team removes all `locations` rows
- Deleting a team removes all `channels` and `channel_members` rows
- Deleting a team removes all `messages` in team channels
- Deleting a team removes all `dm_channels` and their `messages`
- Deleting a team sets `profiles.active_team_id` to NULL for affected members (SET NULL behavior)
- After a team is deleted, storage objects that were under `team-images/{team_id}/` are no longer accessible via the RLS policies (former members cannot SELECT them) — confirms objects would be orphaned if not explicitly cleaned up by the server action

---

### 3. RLS Tests - `tests/rls/team-members.test.ts` (additions)

These test the owner self-removal guardrail. This is enforced in the server action rather than RLS, but the guardrail logic needs coverage.

> **Note:** Since the guardrail lives in the `removeTeamMember` server action rather than an RLS policy, these cases are covered in the server action tests below (section 4). No additional RLS test is needed for this - RLS itself still permits the DELETE; the block is app-level.

---

### 4. Server Action Tests - `tests/unit/team-actions.test.ts` (new file)

The `deleteTeam` and `transferOwnership` server actions contain authorization logic that runs before the service-role DB call. These tests mock the Supabase client to isolate the logic.

**`deleteTeam` action**
- Returns `{ error: "Unauthorized" }` when called by an unauthenticated user
- Returns `{ error: "Not authorized" }` when called by a non-owner admin (coach or manager)
- Returns `{ error: "Not authorized" }` when called by a player
- Returns `{ success: true }` when called by the team owner
- Dispatches deletion notifications (calls the notification helper) before executing the DELETE
- For a team with a mix of auth-backed and managed members: auth-backed members are notified directly; managed members' managers receive the email instead; push is not attempted for managed profiles
- Deletes storage objects under `team-images/{team_id}/` before executing the DELETE (verified by asserting the storage delete call is made with the correct bucket and prefix)

**`transferOwnership` action**
- Returns `{ error: "Unauthorized" }` when called by an unauthenticated user
- Returns `{ error: "Not authorized" }` when called by a non-owner
- Returns `{ error: "Cannot transfer to a player" }` (or equivalent) when recipient is a player
- Returns `{ error: "Cannot transfer to a managed profile" }` (or equivalent) when recipient has `auth_user_id IS NULL` — even if they hold an admin role somehow
- Returns `{ error: "Recipient is not a team member" }` when recipient is not on the team
- Returns `{ success: true }` and updates `owner_id` when owner transfers to a valid auth-backed admin

**`removeTeamMember` action (additions)**
- Returns `{ error: "Transfer ownership before leaving the team" }` (or equivalent) when the **owner** attempts to remove themselves
- Non-owner admins can still remove themselves (existing behavior unchanged)

---

### 5. Unit Tests - `tests/unit/email.test.ts` (additions)

Test the new team-deletion notification email template (alongside the existing invite email tests).

- HTML output contains the team name
- HTML output contains a message indicating the team was permanently deleted
- HTML output does not contain an action button or invite link (informational only)
- `buildTeamDeletionEmailHtml` produces valid-looking HTML (has `<table>`, closes tags)

---

### 6. E2E Tests - `tests/e2e/team-deletion.spec.ts` (new file)

Full browser tests covering the happy path and key guardrails.

**Ownership transfer**
- Team owner sees "Transfer Ownership" in Team Settings; non-owner admin does not
- Owner can successfully transfer ownership to a coach; after transfer, the former owner no longer sees the "Transfer Ownership" or "Delete Team" controls
- Owner cannot transfer to a player (player does not appear in the recipient list)

**Team deletion**
- Team owner sees "Delete Team" in Team Settings danger zone; non-owner admin does not
- Clicking "Delete Team" opens a confirmation dialog
- Submitting the dialog with the wrong team name keeps the dialog open and does not delete
- Submitting with the correct team name deletes the team and redirects the owner to `/dashboard`
- After deletion, a member with no other teams sees the "Welcome / create a team" blank state on `/dashboard`
- After deletion, a member with another team is silently switched to that team on next navigation

---

### Helpers - `tests/rls/helpers.ts` (additions)

The `createTestTeam` helper will need to be updated to set `owner_id` on the team row once the column is added. Any test that calls `createTestTeam` and expects a specific owner implicitly depends on this - no separate helper should be needed, but the update must not break existing tests.

---

## Out of Scope

- Bulk deletion of multiple teams at once
- Organization-level deletion
- Data export before deletion
- Soft delete / archiving
