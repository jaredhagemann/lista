# App Store Feedback Mitigations — v1.0.7

Submission ID: b1c28e0c-bd63-401d-82b1-77d8a17487b5
Review date: April 07, 2026

---

## Issue 1 — Guideline 2.3.7: Accurate Metadata (Subtitle)

### What Apple flagged
The subtitle "Free sports team management" contains the word "Free", which Apple classifies as a price reference. Price references are not permitted in the subtitle field.

### Proposed fix
This is a metadata-only change — no code required. Update the subtitle in App Store Connect to remove the pricing reference.

**Proposed new subtitle:** `Sports team management` (22 chars)

This accurately describes the app without any price language. The "no fees, no ads" messaging can remain in the description, which Apple explicitly permits.

### Steps
1. Open App Store Connect → Lista → App Information
2. Replace the subtitle with `Sports team management`
3. Save and resubmit

---

## Issue 2 — Guideline 5.1.1(v): Account Deletion

### What Apple flagged
The app supports account creation but does not provide an in-app option to permanently delete an account. Apple's requirements:
- Deletion must be permanent (deactivation/disabling is not sufficient)
- Must be initiatable from within the app
- If the flow completes on a website, the app must link directly to that page
- A confirmation step is allowed; requiring a support email or phone call is not

### Current state
The iOS settings screen has no account deletion option. The web app has team deletion (for team owners) but no account deletion. The support page currently tells users to email `support@lista.team` to delete their account — this does not meet Apple's requirements.

### Proposed fix

#### Backend — new API route (`apps/web/src/app/api/account/delete/route.ts`)
Add a `DELETE` endpoint that:
1. Authenticates the caller by validating their Supabase session from the `Authorization: Bearer <token>` header
2. Uses the Supabase service role client to call `auth.admin.deleteUser(userId)`, which permanently deletes the auth user and cascades to their `profiles` row (via existing `ON DELETE CASCADE` constraints)
3. Returns `200` on success, appropriate error codes otherwise

This keeps the service role key server-side and out of the mobile app.

#### iOS — "Delete Account" entry in Settings (`apps/mobile/app/(app)/settings/index.tsx`)
Add a new destructive `NavRow` at the bottom of the settings screen (below Sign Out) labelled "Delete Account".

On press:
1. Show a two-step confirmation `Alert`:
   - Step 1: "Are you sure? This will permanently delete your account and all your data. This cannot be undone." → buttons: Cancel / Continue
   - Step 2: "This is permanent. Your account, profile, and all team memberships will be deleted." → buttons: Cancel / Delete Account
2. On confirmation, retrieve the current session token (`supabase.auth.getSession()`) and call the `DELETE /api/account/delete` endpoint with `Authorization: Bearer <token>`
3. On success, call `supabase.auth.signOut()` and navigate to `/(auth)/login`
4. On error, show an alert: "Something went wrong. Please try again or contact support@lista.team."

#### Support page update (`apps/web/src/app/support/page.tsx`)
Update the "How do I delete my account?" FAQ entry to reflect that deletion is available directly in the app under Settings → Delete Account, rather than via email.

### What this covers per Apple's requirements
| Requirement | How it's met |
|---|---|
| Must be permanent | `auth.admin.deleteUser()` hard-deletes the auth user and cascades to all data |
| Must be initiatable in-app | "Delete Account" row in iOS Settings |
| No email/phone required | Fully self-serve within the app |
| Confirmation steps allowed | Two-step Alert confirmation before deletion proceeds |

### Out of scope
- Web app account deletion UI — not required for this submission but worth adding as a follow-up for consistency
- Handling of teams the user owns — if the deleting user is a team owner, the team's `owner_id` will be set to `NULL` (via the existing `ON DELETE SET NULL` constraint on `teams.owner_id`). The team will continue to exist. A follow-up improvement could warn the user and prompt ownership transfer first, but this is not required to satisfy Apple's guideline.
