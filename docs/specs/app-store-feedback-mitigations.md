# App Store Feedback Mitigations — v1.0.7

Submission ID: b1c28e0c-bd63-401d-82b1-77d8a17487b5
Review date: April 07, 2026

---

## Issue 1 — Guideline 5.1.1(v): Account Deletion

### What Apple flagged
The app supports account creation but does not provide an in-app option to permanently delete an account. Apple's requirements:
- Deletion must be permanent (deactivation/disabling is not sufficient)
- Must be initiatable from within the app
- If the flow completes on a website, the app must link directly to that page
- A confirmation step is allowed; requiring a support email or phone call is not

### Current state
The iOS settings screen has no account deletion option. The web app has team deletion (for team owners) but no account deletion. The support page currently tells users to email `support@lista.team` to delete their account — this does not meet Apple's requirements.

### Proposed fix

#### Backend — `apps/web/src/app/api/account/delete/route.ts`

A single route file exports two HTTP method handlers (`GET` and `DELETE`). They are intentionally distinct so that the deletion handler is never called until after the user has confirmed.

**`GET` handler — eligibility check**
1. Authenticates the caller via the `Authorization: Bearer <token>` header
2. Queries `teams` for any row where `owner_id = userId`
3. Returns `200 OK` with `{ "eligible": true }` if no owned teams exist
4. Returns `409 Conflict` with `{ "error": "owns_teams", "teams": ["Team A", "Team B"] }` if the user owns one or more teams

| Status | Condition | Body |
|---|---|---|
| `200 OK` | Authenticated, user owns no teams | `{ "eligible": true }` |
| `401 Unauthorized` | `Authorization` header missing, token malformed, or token expired | `{ "error": "unauthorized" }` |
| `409 Conflict` | User owns one or more teams | `{ "error": "owns_teams", "teams": ["…"] }` |

**`DELETE` handler — perform deletion**
1. Authenticates the caller via the `Authorization: Bearer <token>` header
2. Re-checks team ownership and returns `409 Conflict` (same shape as above) if the user still owns teams — this guards against any race between the eligibility check and confirmation
3. Uses the Supabase service role client to call `auth.admin.deleteUser(userId)`, which hard-deletes the auth user and triggers the cascade deletions described in the **Deletion inventory** below
4. Returns `200` on success, appropriate error codes otherwise

| Status | Condition | Body |
|---|---|---|
| `200 OK` | Authenticated, user owns no teams, deletion succeeded | `{ "deleted": true }` |
| `401 Unauthorized` | `Authorization` header missing, token malformed, or token expired | `{ "error": "unauthorized" }` |
| `409 Conflict` | User owns one or more teams (race between eligibility check and confirmation) | `{ "error": "owns_teams", "teams": ["…"] }` |
| `500 Internal Server Error` | `auth.admin.deleteUser()` returned an error | `{ "error": "deletion_failed" }` |

All `401` cases (missing header, malformed token, expired token) return the same shape and are treated identically by clients: surface a generic error and do not attempt sign-out or navigation, since the user's local session state is unknown.

This keeps the service role key server-side and out of the mobile app.

#### Deletion inventory

The table below defines exactly what is and is not deleted when `auth.admin.deleteUser()` is called. Implementors must verify the complete FK cascade chain in `supabase/migrations/` before shipping to confirm no rows are silently orphaned beyond what is listed here.

| Record | Outcome | Mechanism |
|---|---|---|
| `auth.users` row | **Deleted** | Hard delete via `auth.admin.deleteUser()` |
| `profiles` row (own) | **Deleted** | `ON DELETE CASCADE` from `auth.users` |
| `team_members` rows (own profile) | **Deleted** | `ON DELETE CASCADE` from `profiles` |
| `notification_preferences` | **Deleted** | `ON DELETE CASCADE` from `profiles` |
| `push_subscriptions` | **Deleted** | `ON DELETE CASCADE` from `profiles` |
| `availability` records (own profile) | **Deleted** | `ON DELETE CASCADE` from `profiles` |
| `teams` (owned) | **Unaffected** | User cannot reach deletion while owning teams; enforced by eligibility check |
| Managed player profiles | **Retained — orphaned** | `profiles` rows with `auth_user_id = NULL` have no FK to `auth.users` and are not cascade-deleted. They remain as independent roster entries on their teams with no managing account. This is intentional: the player records belong to the team, not to the account holder's identity. |

The confirmation copy in both iOS and web flows must not claim that "all data" is deleted, because managed player profiles are intentionally retained.

#### iOS — "Delete Account" entry in Settings (`apps/mobile/app/(app)/settings/index.tsx`)
Add a new destructive `NavRow` at the bottom of the settings screen (below Sign Out) labelled "Delete Account".

On press:
1. Retrieve the current session token (`supabase.auth.getSession()`) and call `GET /api/account/delete` with `Authorization: Bearer <token>`
2. If the response is `409 Conflict` with `"error": "owns_teams"`, show an alert: "You are the owner of one or more teams. Transfer or delete your team(s) before deleting your account." → buttons: Cancel / "Team Settings". Tapping "Team Settings" dismisses the alert and navigates to the Team section of Settings. Do not proceed with deletion.
3. If `GET` returns `200`, show a two-step confirmation `Alert`:
   - Step 1: "Are you sure? This will permanently delete your account and personal data. This cannot be undone." → buttons: Cancel / Continue
   - Step 2: "This is permanent. Your account, profile, and team memberships will be deleted." → buttons: Cancel / Delete Account
4. On final confirmation, call `DELETE /api/account/delete` with `Authorization: Bearer <token>`
5. On `200`, the server-side session is already invalid because the auth user no longer exists. Call `supabase.auth.signOut()` as a best-effort local cleanup step — the Supabase client clears local session storage regardless of whether the server-side token revocation succeeds or returns a 401. Await the call but treat any error as non-fatal. Navigate to `/(auth)/login` unconditionally after the call completes or errors.
6. On any error from the DELETE (including an unexpected `409`), show an alert: "Something went wrong. Please try again or contact support@lista.team."

**Loading and disabled states:**
- While the GET request is in flight (step 1), the "Delete Account" `NavRow` shows an activity indicator and is non-interactive to prevent double-taps. It returns to its normal state once the GET resolves.
- While the DELETE request is in flight (step 4), dismiss the step 2 alert and show a full-screen or modal activity indicator. The user should not be able to navigate away or interact with the screen during this period.

#### Web app — Account settings tab (`apps/web/src/app/dashboard/settings/page.tsx`)

Add a new "Account" tab to the existing `<Tabs>` on the settings page, alongside "Notifications" and "Team". The tab is always visible (not gated on team membership).

The Account tab contains two sections, described below.

##### Password reset

The app uses password-based authentication only; OAuth providers are not supported. The password reset form is therefore always applicable to authenticated users.

An inline form with three fields: Current password, New password, Confirm new password. Implemented via a Next.js Server Action (`apps/web/src/app/dashboard/settings/actions.ts`) to avoid client-side auth state side effects from verifying the current password while already authenticated.

On submit:
1. Validate client-side that "New password" and "Confirm new password" match; show an inline error if not. The submit button is disabled while validation fails and while the action is in flight.
2. Invoke the Server Action with `{ currentPassword, newPassword }`. The action:
   a. Retrieves the authenticated user's email from the server-side Supabase client
   b. Calls `supabase.auth.signInWithPassword({ email, password: currentPassword })` on a fresh server-side client to verify the current password — this does not affect the browser session or trigger client-side auth state changes
   c. If verification fails, returns `{ error: "current_password_incorrect" }`
   d. On success, calls `adminClient.auth.admin.updateUserById(userId, { password: newPassword })` via the service role client — no new client session is created
   e. Returns `{ success: true }` or `{ error: "update_failed" }`
3. On `current_password_incorrect`, show an inline error: "Current password is incorrect."
4. On `success`, show an inline success message: "Password updated."
5. On any other error, show: "Something went wrong. Please try again."

##### Account deletion

Placed at the bottom of the Account tab, below the password reset section, separated by a visible divider. Rendered with a destructive visual treatment (e.g., red heading or border).

A single "Delete Account" button (destructive variant). On click:
1. Call `GET /api/account/delete` with `Authorization: Bearer <session token>`
2. If the response is `409 Conflict` with `"error": "owns_teams"`, show an inline error: "You are the owner of the following team(s): [team names]. Transfer or delete these teams before deleting your account." followed immediately by a "Go to Team Settings" button that navigates to `/dashboard/settings?tab=team`. Do not open any confirmation dialog.
3. If `GET` returns `200`, open a confirmation dialog:
   - Text: "This will permanently delete your account, profile, and personal data. This cannot be undone."
   - Buttons: Cancel / "Delete Account" (destructive)
4. On confirmation, call `DELETE /api/account/delete` with `Authorization: Bearer <session token>`
5. On `200`, the server-side session is already invalid because the auth user no longer exists. Call `supabase.auth.signOut()` as a best-effort local cleanup step — the Supabase client clears local cookies and storage regardless of whether the server-side token revocation succeeds or returns a 401. Await the call but treat any error as non-fatal. Redirect to `/login` unconditionally after the call completes or errors. Do not rely on the Next.js middleware's 401-driven redirect as the primary mechanism — the proactive redirect ensures the user sees the login screen immediately rather than experiencing a jarring mid-page auth failure.
6. On any error from the DELETE (including an unexpected `409`), show an inline error: "Something went wrong. Please try again or contact support@lista.team."

**Loading and disabled states:**
- While the GET request is in flight (step 1), the "Delete Account" button shows a loading indicator and is disabled to prevent double-submission. It returns to its normal state once the GET resolves (whether to an error or the confirmation dialog).
- While the DELETE request is in flight (step 4), the confirmation dialog's "Delete Account" button shows a loading indicator and is disabled. The Cancel button is also disabled during this period.

#### Web app — User dropdown (`apps/web/src/components/layout/dashboard-nav.tsx`)

The user's display name in the dropdown menu (currently a static `<p>` element) should become a clickable link to `/dashboard/settings?tab=account`. The email line below it remains static text.

The settings page must read the `tab` query parameter and use it as the `defaultValue` of the `<Tabs>` component, falling back to `"notifications"` when absent.

#### Support page update (`apps/web/src/app/support/page.tsx`)
Update the "How do I delete my account?" FAQ entry to reflect that deletion is available directly in the app under Settings → Delete Account, rather than via email.

### What this covers per Apple's requirements
| Requirement | How it's met |
|---|---|
| Must be permanent | `auth.admin.deleteUser()` hard-deletes the auth user, profile, memberships, and personal data (see Deletion inventory) |
| Must be initiatable in-app | "Delete Account" row in iOS Settings; "Delete Account" button on web Account settings tab |
| No email/phone required | Fully self-serve within the app |
| Confirmation steps allowed | Two-step Alert on iOS; confirmation dialog on web |

### Out of scope
- Ownership transfer flow — users who own teams must transfer or delete those teams before deleting their account (enforced by the API), but the UI does not provide an in-context shortcut to do so. Users follow the existing team settings flow separately.
- Deleting or anonymizing managed player profiles — these are intentionally retained as orphaned roster entries (see Deletion inventory). A follow-up could add logic to either delete them or transfer their management to a team admin, but that is not required to satisfy Apple's guideline.
