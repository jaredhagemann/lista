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

## Data Cleanup — Open Questions

The `team_members` delete is the only strictly necessary change, but several related records become stale. Decisions are needed on each:

### 1. Availability responses
The removed member may have submitted availability for upcoming events. Should these be:
- **Deleted** — clean slate, upcoming events show them as no response
- **Preserved** — historical record is kept, but the response is no longer acted upon

Leaning toward **delete upcoming, preserve past**: delete `availability` rows for events with `start_time > now()` where `profile_id` matches the removed member. Past responses retain historical accuracy.

### 2. Channel membership (group channels)
If the member was explicitly added to a group channel (`channel_members` row), they will still appear as a member of that channel after removal. Team channels are fine — access is gated by `is_team_member()` — but group channels use `is_channel_member()` which checks `channel_members` directly. Should the `channel_members` rows be deleted on removal?

Leaning toward **yes** — stale channel membership is confusing for admins managing group channels.

### 3. Pending invitations
If there is an outstanding invitation for this member (e.g. they were invited but haven't accepted yet, or a re-invite was sent), should it be expired/cancelled?

Leaning toward **yes** — a pending invitation for a removed member should be voided to prevent them from re-joining via the invite link.

### 4. Notification preferences
The `notification_preferences` table has a row per profile per team. This is low-stakes — it's a small record and has no user-visible impact once team access is gone. Leaning toward **leave in place** for now (simplicity), but could be cleaned up later.

### 5. Push subscriptions
`push_subscriptions` rows are per-device, not per-team, so they should not be touched.

### 6. Can an admin remove themselves?
A coach could navigate to their own profile and trigger this action. This should probably be **blocked** in the UI (hide the button on own profile) and optionally at the server level. Leaving a team via self-removal is a separate, lower-priority feature.

## Migration

No schema changes are required. The existing RLS DELETE policy on `team_members` already allows admins to delete any member. Any cleanup queries (availability, channel_members, invitations) can be executed as additional client-side Supabase calls or as a server action — no new tables or columns needed.

If we decide to make cleanup atomic, a Postgres function or a Next.js server action wrapping multiple deletes is the right approach. This avoids partial state if one of the cleanup steps fails.

## RLS Test Coverage Needed

- Admin can remove a player ✓ (already tested in `tests/rls/team-members.test.ts`)
- Admin can remove another coach/manager
- Non-admin (player) cannot remove anyone
- Admin cannot remove themselves (if we block this)
- After removal, ex-member cannot read team events, channels, or availability
- After removal, ex-member's profile manager cannot read team data (unless they manage another active member)
