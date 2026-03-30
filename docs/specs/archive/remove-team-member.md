# Remove Team Member

## Overview

Coaches and managers need a clear, accessible way to remove a member from the team. This action should be non-destructive to user data — it removes team access only, leaving the profile, availability history, and account intact.

## Current State

A "Remove from team" button already exists in `src/components/team/roster-profile.tsx`, but it is buried inside the **Admin Actions** card which is only rendered in edit mode. This makes it unnecessarily hard to find and is grouped with role/jersey editing — a different category of action.

The existing implementation:
- Deletes the `team_members` row matching `id` and `team_id`
- Shows a confirmation dialog before proceeding
- Redirects to `/dashboard/team` on success
- Does nothing else (no cleanup of related records)

## Proposed Changes

### UI

Move "Remove from team" out of edit mode and into its own section at the bottom of the profile page, always visible to admins regardless of whether they are in edit mode. It should be visually separated from the profile content (e.g., a distinct destructive section below all other cards) to signal it is a different category of action.

The confirmation dialog should make the consequences clear:
- The member's profile and history are preserved
- They will lose access to the team and all team data
- Their profile managers (e.g., parents) will also lose access

### Access Removal

Deleting the `team_members` row is sufficient to revoke access for both the member and their profile managers. The `is_team_member()` helper — which gates all team-scoped RLS policies — works by joining `team_members` to `profile_managers`. Once the `team_members` row is gone, `is_team_member()` returns false for both the member and any parent/guardian who managed them via that team membership.

There is one exception: if the removed member is a profile manager of *another player who is still on the team*, they retain `is_team_member()` access via that second managed profile. This is correct behaviour — a parent whose child is still on the team should still have access.

### Who Can Perform This Action

Any team member with `role = 'coach'` or `role = 'manager'` (i.e. `is_team_admin()` returns true). The existing RLS DELETE policy on `team_members` already enforces this.

### Who Can Be Removed

Any current team member, including other coaches and managers. The UI should not special-case this — it is valid for a coach to remove another coach (e.g. if they left the organisation).

### Scope: Web Only (for now)

The iOS app does not yet have edit capabilities on team/profile screens. iOS support will be addressed in a follow-on feature.

## Data Cleanup

The `team_members` delete is the only strictly necessary change, but the following related records must also be cleaned up in the same operation:

### 1. Availability responses
Delete `availability` rows for events with `start_time > now()` where `profile_id` matches the removed member. Past responses are preserved for historical accuracy.

### 2. Channel membership (group channels)
Delete all `channel_members` rows for the removed member in channels belonging to this team. Team channel access is already gated by `is_team_member()`, but group channels use `is_channel_member()` which checks `channel_members` directly — stale rows would leave them listed as group members.

### 3. Pending invitations
Void any `invitations` rows for this team where `profile_id` matches the removed member and `accepted_at IS NULL`. This prevents them from re-joining via an existing invite link.

### 4. Notification preferences
Leave in place — low-stakes, no user-visible impact once team access is gone.

### 5. Push subscriptions
Leave in place — these are per-device, not per-team.

### 6. Self-removal
Block in the UI: hide the "Remove from team" button when viewing your own profile. This prevents accidental self-removal. Intentionally leaving a team is a separate, lower-priority feature.

## Migration

No schema changes are required. The existing RLS DELETE policy on `team_members` already allows admins to delete any member. Any cleanup queries (availability, channel_members, invitations) can be executed as additional client-side Supabase calls or as a server action — no new tables or columns needed.

The cleanup steps should be atomic — use a Next.js server action wrapping all deletes so partial state cannot occur if one step fails.

## RLS Test Coverage Needed

- Admin can remove a player ✓ (already tested in `tests/rls/team-members.test.ts`)
- Admin can remove another coach/manager
- Non-admin (player) cannot remove anyone
- Admin cannot remove themselves (button hidden on own profile)
- After removal, ex-member cannot read team events, channels, or availability
- After removal, ex-member's profile manager cannot read team data (unless they manage another active member)
