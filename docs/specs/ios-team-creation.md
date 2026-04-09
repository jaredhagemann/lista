# iOS Team Creation

## Overview

Two entry points into team creation are added to the iOS app:

1. **No-team home screen** — replace the current "ask your coach for an invite link" placeholder with a proper empty state offering both "Create a team" and "I have an invite link" options.
2. **Switcher sheet** — add a "Create a new team" row at the bottom of the Teams section, accessible at any time regardless of whether the user is already on a team.

Both entry points navigate to a new `CreateTeamScreen`.

Team creation is backed by a new shared server endpoint (`POST /api/teams`) that is used by **both** the iOS app and the web form. This replaces the current pattern of sequential client-side Supabase inserts with a single atomic operation, and provides one place to maintain creation logic, validation, and active-team assignment going forward.

## Active context design

The codebase has two layers of active context:

1. **Active team** — `profiles.active_team_id` in the database (shared, authoritative)
2. **Active viewed profile** — stored per-client: a cookie on web (`dashboard/layout.tsx`), `SecureStore` on iOS (`AppContext.tsx`)

The endpoint is responsible for layer 1 only — it writes `active_team_id` as part of the atomic creation transaction and returns `{ teamId }`. It does not attempt to mutate browser cookies or device storage, and its response shape carries no client-state flags (e.g. no `shouldResetActiveProfile`). Coupling the endpoint's response to client-side state management concerns would leak UI decisions into a layer that has no business knowing about them.

Each client is responsible for resetting its own active-profile state after a successful creation:

- **Web** — calls `router.refresh()`, which re-fetches the server layout. The layout reads the active profile from the cookie and resolves context naturally. No explicit cookie reset needed — the newly active team has no managed profiles yet, so the own profile is always correct.
- **iOS** — explicitly calls `await SecureStore.deleteItemAsync('active_profile_id')` before calling `refresh()`. This is necessary because the user may have had a managed profile active in SecureStore at the time of creation. That profile will not be a member of the new team, and while `loadData()` falls through gracefully, an explicit reset is cleaner and avoids a transient state where the app is viewing as a profile with no membership. After the delete, `refresh()` re-runs `loadData()`, which resolves `membership` from the updated `active_team_id` viewing as the own profile.

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
3. Insert `teams` row (`id`, `organization_id`, `name`, `season`, `owner_id = userId`)
4. Insert `team_members` row (`team_id`, `profile_id = userId`, `role = 'coach'`)
5. Update `profiles.active_team_id = teamId` for the calling user

Steps 2–5 are wrapped in a Postgres transaction via `supabase.rpc('create_team', { ... })` (see migration below), making the entire operation atomic. A failure at any step rolls back all changes — no orphaned records.

**Chat channel provisioning is part of this contract.** The `teams` INSERT in step 3 fires the `create_team_channel` trigger (`supabase/migrations/20260307000000_team_chat.sql`, line 68), which creates the team-wide `channels` row and seeds it with a `channel_members` row for the new coach. This is not an incidental side effect — it is a guaranteed part of what "create a team" means in this system. The spec calls it out explicitly so that any future changes to the RPC (e.g. a dry-run mode, a bulk-import path, or a test helper that bypasses the trigger) are made with full awareness that chat provisioning would need to be handled separately.

**Response:** `{ teamId }` on success, appropriate 4xx/5xx on failure.

### New migration — `supabase/migrations/YYYYMMDD_create_team_rpc.sql`

A `security definer` Postgres function `create_team(owner_profile_id uuid, team_name text, season text, org_name text)` that wraps all four inserts/updates in a single transaction and returns the new `team_id`.

**Identity resolution is the server route's responsibility, not the function's.** The route resolves the calling user from the session token and passes the resulting `owner_profile_id` as an explicit argument. The function treats it as a trusted input and never calls `auth.uid()` internally.

This separation matters because `security definer` is a privilege-escalation mechanism (bypass RLS), not an identity-resolution mechanism. If the function derived identity from session context rather than accepting it as an argument, the correctness of the function would depend on implicit session state that may not be set depending on how the function is invoked. Passing `owner_profile_id` explicitly makes the function a pure data operation: given this already-verified identity, create this team.

This also keeps the door open for future callers that act on behalf of a different profile — the server route would resolve both the auth user and the target profile ID, and pass them in deliberately. The function signature could extend to `create_team(owner_profile_id, acting_user_id, ...)` without changing how identity resolution works.

---

## New shared helper — `apps/web/src/lib/api-auth.ts`

`/api/teams` will be the first route callable from both web (cookie session) and mobile (Bearer token). Rather than adding another hand-rolled auth block, this is the right moment to factor out a shared helper that all hybrid routes use.

**`resolveRequestUser(request: Request): Promise<User | null>`**

Resolution order:
1. Try cookie-based auth via `createServerClient` (the existing server Supabase client from `@/lib/supabase/server`) — covers web callers
2. If no cookie session, check for `Authorization: Bearer <token>` header and verify via `adminClient().auth.getUser(token)` — covers mobile callers
3. Return the resolved `User`, or `null` if neither method succeeds

The helper also exports `adminClient()` as a named function so routes don't each inline the service-role client construction.

**Existing routes to migrate onto the helper:**

| Route | Current issue |
|---|---|
| `api/managed-profiles/route.ts` | Bearer-only; uses `authHeader.replace("Bearer ", "")` (doesn't validate prefix); uses anon client for `getUser` |
| `api/account/owned-teams/route.ts` | Bearer-only; has local `getBearerToken` + `authenticateRequest` helpers that duplicate what the shared helper will do; uses anon client for `getUser` |
| `api/account/delete/route.ts` | Should be checked for consistency |
| `api/invite/[id]/accept/route.ts` | Bearer-only; uses admin client for `getUser` (inconsistent with others) |

Migrating these routes is in scope for this PR — the `/api/teams` work touches `api-auth.ts` anyway, and leaving the duplicates in place immediately after introducing the helper defeats the purpose.

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
3. On success:
   - `await SecureStore.deleteItemAsync('active_profile_id')` — reset any active managed profile before refreshing context (see Active context design above)
   - `await refresh()` from `AppContext` — re-runs `loadData()`, resolves `membership` to the new team viewing as own profile
   - `router.replace('/(app)')`
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
