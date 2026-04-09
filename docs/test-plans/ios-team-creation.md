# Test Plan — iOS Team Creation

Spec: `docs/specs/ios-team-creation.md`

---

## 1. API — `POST /api/teams`

### 1.1 — Authentication

| # | Scenario | Setup | Expected response |
|---|---|---|---|
| 1.1.1 | No `Authorization` header, no cookie | Unauthenticated request | `401 { "error": "unauthorized" }` |
| 1.1.2 | Malformed Bearer token | `Authorization: Bearer not-a-jwt` | `401 { "error": "unauthorized" }` |
| 1.1.3 | Expired Bearer token | Valid JWT with past `exp` claim | `401 { "error": "unauthorized" }` |
| 1.1.4 | Valid Bearer token (mobile caller) | Authenticated mobile session | Request proceeds to creation logic |
| 1.1.5 | Valid cookie session (web caller) | Authenticated browser session, no `Authorization` header | Request proceeds to creation logic |

### 1.2 — Request validation

| # | Scenario | Body | Expected response |
|---|---|---|---|
| 1.2.1 | Missing `teamName` | `{}` | `400 { "error": "teamName is required" }` |
| 1.2.2 | `teamName` is empty string | `{ "teamName": "" }` | `400 { "error": "teamName is required" }` |
| 1.2.3 | `teamName` only, no optional fields | `{ "teamName": "U12 Boys Blue" }` | `200 { "teamId": "<uuid>" }` |
| 1.2.4 | All fields provided | `{ "teamName": "U12 Boys Blue", "season": "Spring 2026", "orgName": "Westside FC" }` | `200 { "teamId": "<uuid>" }` |
| 1.2.5 | `orgName` omitted — org name defaults to team name | `{ "teamName": "U12 Boys Blue" }` | `200`; assert `organizations.name = "U12 Boys Blue"` for the created org |

### 1.3 — Creation cascade verification (sub-cases for a successful `200`)

| Record | Assertion |
|---|---|
| `organizations` row | Row exists with the correct `name` |
| `teams` row | Row exists with correct `name`, `season`, `organization_id`, and `owner_id = userId` |
| `team_members` row | Row exists with `team_id`, `profile_id = userId`, `role = 'coach'` |
| `profiles.active_team_id` | Updated to the new `teamId` for the calling user |
| `channels` row | A `type = 'team'` channel row exists for the new team (trigger fired) |

### 1.4 — Atomicity

| # | Scenario | Setup | Expected result |
|---|---|---|---|
| 1.4.1 | Transaction rolls back on failure | Simulate a failure inside the `create_team` RPC (e.g. constraint violation on `team_members`) | `500` response; no `organizations`, `teams`, or `team_members` rows created for the attempted team |

---

## 2. Shared helper — `src/lib/api-auth.ts`

### 2.1 — Migrated routes still authenticate correctly

For each migrated route (`/api/managed-profiles`, `/api/account/owned-teams`, `/api/account/delete`, `/api/invite/[id]/accept`):

| # | Scenario | Setup | Expected result |
|---|---|---|---|
| 2.1.1 | Valid Bearer token still accepted | Send a valid Bearer token to each migrated route | Route proceeds as before (same response as pre-migration) |
| 2.1.2 | No token still returns 401 | Send no `Authorization` header and no cookie | `401` response |
| 2.1.3 | Malformed token still returns 401 | Send `Authorization: Bearer not-a-jwt` | `401` response |

---

## 3. Middleware allowlist

| # | Scenario | Setup | Expected result |
|---|---|---|---|
| 3.1 | `POST /api/teams` is not redirected for unauthenticated-looking requests | Send a Bearer-only request (no cookie) to `POST /api/teams` | Request reaches the route handler; receives `401` from the handler (not a `302` redirect to `/login`) |
| 3.2 | Authenticated web requests to `POST /api/teams` still work | Send a cookie-authenticated request | `200` response |

---

## 4. Web — `CreateTeamForm` refactor

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 4.1 | `teamName` is required | Submit the form with an empty team name field | Form does not submit; inline validation error shown |
| 4.2 | Successful creation with only team name | Fill in team name; leave season and org name blank; submit | Team created; redirected to `/dashboard`; new team is active |
| 4.3 | Successful creation with all fields | Fill in all three fields; submit | Team created; `organizations.name` matches org name field; redirected to `/dashboard` |
| 4.4 | Submit button shows loading state | Submit a valid form | Button is disabled and shows "Creating..." for the duration of the request |
| 4.5 | Error state on API failure | Mock `POST /api/teams` to return `500`; submit | Inline error message shown; user remains on the form |

### 4.6 — Active profile cookie reset on web

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 4.6.1 | Own profile active — context resolves correctly | Create a team while viewing as own profile | After redirect, dashboard shows the new team; own profile is active |
| 4.6.2 | Managed profile active — cookie is cleared before redirect | Switch to a managed profile; create a team | After redirect, `active_profile_id` cookie is absent; dashboard resolves to own profile on the new team |
| 4.6.3 | Managed profile is not shown as active on new team | Same as 4.6.2 | The managed profile does not appear as the active context anywhere in the dashboard after redirect |

---

## 5. iOS — `CreateTeamScreen`

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 5.1 | Screen is reachable from no-team home screen | Launch app with no team membership; tap "Create a team" | `CreateTeamScreen` is presented |
| 5.2 | Screen is reachable from switcher sheet | Tap the team/role selector; tap "Create a new team" | Sheet dismisses; `CreateTeamScreen` is presented |
| 5.3 | Cancel navigates back without creating | Open `CreateTeamScreen`; tap Cancel/back | Screen dismissed; no team created; no Supabase writes made |
| 5.4 | `teamName` is required | Leave team name blank; tap submit | Submit button remains disabled OR inline validation error shown; no request fired |
| 5.5 | Successful creation with only team name | Enter team name; tap submit | Team created; `SecureStore` `active_profile_id` key is absent after creation; app navigates to home screen showing new team |
| 5.6 | Successful creation with all fields | Fill all three fields; tap submit | Team created; all fields persisted correctly in the database |
| 5.7 | Submit button shows loading state | Tap submit on a valid form | Button is disabled and shows "Creating..." for the duration of the request |
| 5.8 | Error state on API failure | Mock `POST /api/teams` to return `500`; submit | Inline error message shown; user remains on the form; no navigation |

### 5.9 — Active context reset on iOS

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 5.9.1 | Own profile active — context resolves correctly | Create a team while own profile is active (no `active_profile_id` in SecureStore) | Home screen shows new team; own profile is active |
| 5.9.2 | Managed profile active — SecureStore cleared before refresh | Switch to a managed profile via the switcher; create a team | After creation, `active_profile_id` key is absent from SecureStore; app resolves to own profile on the new team |
| 5.9.3 | Managed profile is not shown as active on new team | Same as 5.9.2 | The managed profile does not appear as the active context after navigation |

---

## 6. iOS — No-team empty states

### 6.1 — Home tab

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 6.1.1 | Empty state shown when no membership | Launch app with no team membership | "Welcome to Lista" empty state shown; "Create a team" button and "I have an invite link" link are visible |
| 6.1.2 | "Create a team" navigates to creation screen | Tap "Create a team" | `CreateTeamScreen` presented |
| 6.1.3 | "I have an invite link" shows alert | Tap "I have an invite link" | Alert shown with invite instructions; no navigation |

### 6.2 — Schedule tab

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 6.2.1 | No stuck spinner when no membership | Navigate to Schedule tab with no membership | "No team yet" empty state shown immediately; no indefinite spinner |
| 6.2.2 | "Create a team" button navigates correctly | Tap "Create a team" on Schedule empty state | `CreateTeamScreen` presented |

### 6.3 — Team tab

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 6.3.1 | No misleading empty roster when no membership | Navigate to Team tab with no membership | "No team yet" empty state shown; "No members yet." text is not shown |
| 6.3.2 | "Create a team" button navigates correctly | Tap "Create a team" on Team empty state | `CreateTeamScreen` presented |

### 6.4 — Chat tab

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 6.4.1 | No stuck spinner when no membership | Navigate to Chat tab with no membership | "No team yet" empty state shown immediately; no indefinite spinner |
| 6.4.2 | "Create a team" button navigates correctly | Tap "Create a team" on Chat empty state | `CreateTeamScreen` presented |

---

## 7. iOS — Switcher sheet

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 7.1 | "Create a new team" row is visible with no membership | Open switcher sheet with no team membership | "Create a new team" row appears in the Teams section |
| 7.2 | "Create a new team" row is visible with existing membership | Open switcher sheet while on an existing team | "Create a new team" row appears at the bottom of the Teams section, below existing team rows |
| 7.3 | Tapping row dismisses sheet and navigates | Tap "Create a new team" | Sheet dismisses; `CreateTeamScreen` is presented |
