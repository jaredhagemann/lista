# iOS Team Creation

## Overview

Two entry points into team creation are added to the iOS app:

1. **No-team home screen** — replace the current "ask your coach for an invite link" placeholder with a proper empty state offering both "Create a team" and "I have an invite link" options.
2. **Switcher sheet** — add a "Create a new team" row at the bottom of the Teams section, accessible at any time regardless of whether the user is already on a team.

Both entry points navigate to a new `CreateTeamScreen`.

Team creation is backed by a new shared server endpoint (`POST /api/teams`) that is used by **both** the iOS app and the web form. This replaces the current pattern of sequential client-side Supabase inserts with a single atomic operation, and provides one place to maintain creation logic, validation, and active-team assignment going forward.

---

## New API endpoint — `apps/web/src/app/api/teams/route.ts`

### `POST /api/teams`

Accepts a JSON body `{ teamName, season?, orgName? }` with a Supabase session token in the `Authorization: Bearer <token>` header (for mobile callers) or via cookie (for web callers — the existing `createClient()` server client handles this automatically).

**Request validation:**
- `teamName` is required and must be a non-empty string
- `season` and `orgName` are optional strings

**Logic** — runs entirely as the service role, bypassing RLS:

1. Resolve the calling user from the session token
2. Insert `organizations` row (`id`, `name = orgName || teamName`)
3. Insert `teams` row (`id`, `organization_id`, `name`, `season`, `owner_id = userId`) — all in the same call
4. Insert `team_members` row (`team_id`, `profile_id = userId`, `role = 'coach'`)
5. Update `profiles.active_team_id = teamId` for the calling user

Steps 2–5 are wrapped in a Postgres transaction via `supabase.rpc('create_team', { ... })` (see migration below), making the entire operation atomic. A failure at any step rolls back all changes — no orphaned records.

**Response:** `{ teamId }` on success, appropriate 4xx/5xx on failure.

### New migration — `supabase/migrations/YYYYMMDD_create_team_rpc.sql`

A `security definer` Postgres function `create_team(user_id, team_name, season, org_name)` that wraps all four inserts/updates in a single transaction and returns the new `team_id`. Running as `security definer` means RLS is bypassed inside the function, eliminating the chicken-and-egg problem (previously worked around with client-side UUID generation).

---

## Web — refactor `apps/web/src/components/team/create-team-form.tsx`

Replace the four sequential Supabase client calls and the `setActiveTeam` server action call with a single `fetch('POST /api/teams', { teamName, season, orgName })`. On success, call `router.push('/dashboard')` and `router.refresh()` as before.

The fields, UI, and error handling remain unchanged.

---

## New iOS screen — `apps/mobile/app/(app)/create-team.tsx`

### Routing

Add `create-team` as a hidden tab in `(app)/_layout.tsx` (using `tabBarButton: () => null`). This keeps it within the `AppProvider` context without restructuring the layout. Navigated to with `router.push('/(app)/create-team')`, returns to `/(app)` on success or cancel.

### Fields

| Field | Required | Placeholder |
|---|---|---|
| Team name | Yes | e.g. U12 Boys Blue |
| Season | No | e.g. Spring 2026 |
| Club / organization name | No | e.g. Westside FC |

### Creation logic

1. Retrieve the session token via `supabase.auth.getSession()`
2. `POST /api/teams` with `Authorization: Bearer <token>` and `{ teamName, season, orgName }`
3. On success: call `refresh()` from `AppContext`, then `router.replace('/(app)')`
4. On error: display inline error message

### UI

- Back/cancel button in the header (navigates back without creating)
- Submit button disabled while loading, shows "Creating..." during the request
- Inline error message on failure
- No success toast needed — home screen reflects the new team immediately after `refresh()`

---

## Changes to the no-team home screen — `apps/mobile/app/(app)/index.tsx`

Replace the current placeholder with a proper empty state:

- Icon: `people-outline` (keep existing)
- Title: "Welcome to Lista"
- Subtitle: "Create a team to get started, or ask your coach for an invite link."
- Primary button: "Create a team" → `router.push('/(app)/create-team')`
- Secondary link: "I have an invite link" → shows an `Alert` with instructions: _"Ask your coach to share the invite link with you. Tap it on your device to join."_ (The invite flow is URL-based and handled in `app/invite/[id].tsx` — there is no in-app entry point, so an informational alert is appropriate.)

---

## Changes to the switcher sheet — `components/SwitcherSheet.tsx`

Add a "Create a new team" row at the bottom of the Teams section (after the team list, before the "View as" divider). The row uses a `+` icon.

The sheet needs a new `onCreateTeam` prop (callback). Tapping the row calls `onClose()` then `onCreateTeam()`. The parent (`TeamProfileStrip`) passes `() => router.push('/(app)/create-team')`.

---

## What is not in scope

- Team avatar/logo upload at creation time (can be set later in Team Settings)
- Joining via invite link from within this flow (handled separately by `app/invite/[id].tsx`)
