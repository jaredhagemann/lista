# Test Plan — Account Deletion

Spec: `docs/specs/app-store-feedback-mitigations.md` — Issue 1 (Guideline 5.1.1(v))

---

## 1. API — `GET /api/account/delete` (eligibility check)

| # | Scenario | Setup | Expected response |
|---|---|---|---|
| 1.1 | No `Authorization` header | Unauthenticated request | `401 { "error": "unauthorized" }` |
| 1.2 | Malformed token | `Authorization: Bearer not-a-jwt` | `401 { "error": "unauthorized" }` |
| 1.3 | Expired token | Valid JWT with past `exp` claim | `401 { "error": "unauthorized" }` |
| 1.4 | Valid token, user owns no teams | Authenticated user with no `teams.owner_id` rows | `200 { "eligible": true }` |
| 1.5 | Valid token, user owns one team | Authenticated user with one `teams.owner_id` row | `409 { "error": "owns_teams", "teams": ["<name>"] }` |
| 1.6 | Valid token, user owns multiple teams | Authenticated user with two or more `teams.owner_id` rows | `409 { "error": "owns_teams", "teams": ["<name1>", "<name2>"] }` |

---

## 2. API — `DELETE /api/account/delete` (perform deletion)

| # | Scenario | Setup | Expected response |
|---|---|---|---|
| 2.1 | No `Authorization` header | Unauthenticated request | `401 { "error": "unauthorized" }` |
| 2.2 | Malformed token | `Authorization: Bearer not-a-jwt` | `401 { "error": "unauthorized" }` |
| 2.3 | Expired token | Valid JWT with past `exp` claim | `401 { "error": "unauthorized" }` |
| 2.4 | Valid token, user owns a team (race guard) | User acquired team ownership between GET and DELETE | `409 { "error": "owns_teams", "teams": ["<name>"] }` |
| 2.5 | Valid token, eligible user | Authenticated user with no owned teams | `200 { "deleted": true }` |
| 2.6 | Supabase admin deletion fails | Mock `auth.admin.deleteUser()` to return an error | `500 { "error": "deletion_failed" }` |

### 2.5 — Deletion cascade verification (sub-cases for scenario 2.5)

After a successful `200`, assert that each of the following is gone from the database:

| Record | Assertion |
|---|---|
| `auth.users` row | Row does not exist for `userId` |
| `profiles` row (own) | No `profiles` row where `auth_user_id = userId` |
| `team_members` rows | No `team_members` rows referencing the deleted profile |
| `notification_preferences` | No rows referencing the deleted profile |
| `push_subscriptions` | No rows referencing the deleted profile |
| `availability` records | No rows referencing the deleted profile |
| Managed player profiles | Fixture: before deletion, insert a `profiles` row with `auth_user_id = NULL` and a `team_members` row linking it to a shared team; record the profile ID. After deletion, assert by that profile ID that the `profiles` row and its `team_members` row still exist. Do not rely on implicit "created by" linkage — the fixture ID is the only reliable handle. |

---

## 3. Web — Account settings tab

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 3.1 | Account tab is always visible | Sign in as any user (with or without team membership); navigate to `/dashboard/settings` | "Account" tab is present alongside "Notifications" |
| 3.2 | `?tab=account` pre-selects the Account tab | Navigate to `/dashboard/settings?tab=account` | Account tab is active on load |
| 3.3 | Missing `tab` param defaults to Notifications | Navigate to `/dashboard/settings` (no query param) | Notifications tab is active on load |

### 3.4 — Password reset

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 3.4.1 | New password and confirm do not match | Fill in valid current password; enter mismatched new/confirm | Submit button remains disabled; inline validation error shown; Server Action is not invoked |
| 3.4.2 | Submit button disabled while action is in flight | Enter valid current password and matching new/confirm; submit | Submit button is disabled and shows a loading state for the duration of the Server Action |
| 3.4.3 | Incorrect current password | Enter wrong current password; enter matching new/confirm; submit | Server Action returns `current_password_incorrect`; inline error: "Current password is incorrect"; browser session is unchanged |
| 3.4.4 | Successful password change | Enter correct current password; enter matching new/confirm; submit | Server Action returns `success`; inline success message: "Password updated."; browser session is unchanged |
| 3.4.5 | New password is usable after change | After 3.4.4, sign out and sign back in with the new password | Sign-in succeeds |
| 3.4.6 | Old password is rejected after change | After 3.4.4, attempt to sign in with the old password | Sign-in fails |

### 3.5 — Account deletion

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 3.5.1 | User owns a team | Click "Delete Account" | Inline error listing team name(s) with a "Go to Team Settings" button; no confirmation dialog shown |
| 3.5.2 | "Go to Team Settings" button navigates correctly | Click "Go to Team Settings" from the ownership error state | Navigates to `/dashboard/settings?tab=team` |
| 3.5.3 | Confirmation dialog appears for eligible user | Click "Delete Account" as a user who owns no teams | Confirmation dialog opens with correct copy; "Delete Account" button is present (destructive style) |
| 3.5.3a | "Delete Account" button is disabled and shows loading while GET is in flight | Click "Delete Account"; observe button state before GET resolves | Button is disabled and shows a loading indicator for the duration of the GET request; returns to normal state once resolved |
| 3.5.3b | Confirmation dialog "Delete Account" button is disabled while DELETE is in flight | Confirm deletion; observe dialog button state before DELETE resolves | Both "Delete Account" and Cancel buttons in the dialog are disabled; "Delete Account" shows a loading indicator for the duration of the DELETE request |
| 3.5.4 | First click fires GET only; account is not deleted | Click "Delete Account" as an eligible user; observe network calls; click Cancel on the confirmation dialog | Only a `GET /api/account/delete` request is made; no `DELETE` request is made; the user's `auth.users` row still exists in the database |
| 3.5.5 | Cancel aborts deletion | Open confirmation dialog; click Cancel | Dialog closes; account is not deleted; user remains on the Account tab |
| 3.5.6 | Successful deletion | Confirm deletion | Account deleted; user is signed out; redirected to `/login` |
| 3.5.7 | User is not accessible after deletion | After 3.5.6, attempt to sign in with the deleted credentials | Sign-in fails |
| 3.5.8 | signOut failure after successful DELETE still redirects | Mock `supabase.auth.signOut()` to throw; confirm deletion | DELETE returns `200`; signOut error is silently ignored; user is still redirected to `/login` |
| 3.5.9 | Backend deletion failure (`500`) | Confirm deletion while mocking a `500` from DELETE | Inline error: "Something went wrong. Please try again or contact support@lista.team."; user remains signed in; no redirect |
| 3.5.10 | Unexpected `409` from DELETE | Confirm deletion while mocking a `409` from DELETE | Same inline error as 3.5.9; user remains signed in; no redirect |
| 3.5.11 | GET returns `401` — generic error, no sign-out, no redirect | Click "Delete Account" while mocking GET to return `401` | Generic inline error shown; no confirmation dialog opened; `supabase.auth.signOut()` is not called; user remains on the Account tab |
| 3.5.12 | DELETE returns `401` — generic error, no sign-out, no redirect | Reach the confirmation dialog normally; mock DELETE to return `401`; confirm deletion | Generic inline error shown; `supabase.auth.signOut()` is not called; no redirect to `/login`; user remains on the Account tab |

---

## 4. Web — User dropdown

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 4.1 | User's name is a link | Open the top-right dropdown | Display name is rendered as a link (not plain text) |
| 4.2 | Link navigates to Account tab | Click the display name in the dropdown | Navigates to `/dashboard/settings?tab=account` with Account tab active |
| 4.3 | Email remains plain text | Open the top-right dropdown | Email address below the name is not a link |

---

## 5. iOS — Delete Account flow

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 5.1 | "Delete Account" row is visible | Open Settings screen | Destructive "Delete Account" `NavRow` appears below Sign Out |
| 5.2 | User owns a team | Tap "Delete Account" | Alert shown: ownership message with Cancel and "Team Settings" buttons; no confirmation step shown |
| 5.3 | "Team Settings" button navigates correctly | Tap "Team Settings" from the ownership alert | Alert dismissed; navigates to Team section of Settings |
| 5.4 | Cancel on ownership alert | Tap Cancel from the ownership alert | Alert dismissed; no navigation; no deletion |
| 5.5 | Step 1 confirmation appears for eligible user | Tap "Delete Account" as a user who owns no teams | Step 1 alert shown with correct copy; buttons: Cancel / Continue |
| 5.5a | "Delete Account" row shows loading and is non-interactive while GET is in flight | Tap "Delete Account"; observe row state before GET resolves | Row shows an activity indicator and does not respond to further taps for the duration of the GET request; returns to normal once resolved |
| 5.5b | Activity indicator shown while DELETE is in flight | Tap through both confirmation steps; observe UI state before DELETE resolves | Step 2 alert is dismissed; a loading indicator is displayed; the screen is non-interactive for the duration of the DELETE request |
| 5.6 | Initial tap fires GET only; account is not deleted | Tap "Delete Account" as an eligible user; observe network calls; tap Cancel on step 1 | Only a `GET /api/account/delete` request is made; no `DELETE` request is made; the user's `auth.users` row still exists in the database |
| 5.7 | Cancel on step 1 | Tap Cancel on step 1 alert | Alert dismissed; no further action |
| 5.8 | Step 2 confirmation appears | Tap Continue on step 1 | Step 2 alert shown with correct copy; buttons: Cancel / Delete Account |
| 5.9 | Cancel on step 2 | Tap Cancel on step 2 alert | Alert dismissed; no deletion |
| 5.10 | Successful deletion | Tap "Delete Account" on step 2 | Account deleted; signed out; navigated to `/(auth)/login` |
| 5.11 | User is not accessible after deletion | After 5.10, attempt to sign in with deleted credentials | Sign-in fails |
| 5.12 | signOut failure after successful DELETE still navigates | Mock `supabase.auth.signOut()` to throw; tap through both confirmation steps | DELETE returns `200`; signOut error is silently ignored; user is still navigated to `/(auth)/login` |
| 5.13 | Backend deletion failure (`500`) | Tap through both confirmation steps while mocking a `500` from DELETE | Alert: "Something went wrong. Please try again or contact support@lista.team."; user remains signed in |
| 5.14 | Unexpected `409` from DELETE | Tap through both confirmation steps while mocking a `409` from DELETE | Same error alert as 5.13; user remains signed in |
| 5.15 | `GET` auth failure (e.g. expired token) | Tap "Delete Account" while session is expired | Error alert shown; no confirmation step; `supabase.auth.signOut()` is not called; user is not deleted |

---

## 6. Support page

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 6.1 | FAQ no longer references email | Navigate to `/support`; find "How do I delete my account?" | Answer does not mention emailing `support@lista.team` |
| 6.2 | FAQ references in-app deletion | Same as above | Answer directs users to Settings → Delete Account in the app |
