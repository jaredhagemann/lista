# iOS — Invite Members

## Overview

Coaches and managers can send team member invitations directly from the iOS app, mirroring the web invite flow at `/dashboard/team/new`. Two distinct invite paths exist:

1. **New team member invite** — invite someone who is not yet on the team (player, coach, or manager). Entry point: a "+" button in the Team tab header, visible only to admins.
2. **Guardian/manager invite for an existing player** — invite a parent or guardian to manage an existing player profile. Entry point: an "Add contact" button on the player's member detail screen, visible only to admins.

Both paths call the existing `POST /api/invitations/send` endpoint, which needs to be updated to accept Bearer token authentication so it is callable from the iOS app.

---

## API changes — Bearer auth support

Two existing API routes are cookie-only today and must be updated to accept Bearer tokens before any iOS UI can call them.

### `POST /api/invitations/send` — `apps/web/src/app/api/invitations/send/route.ts`

Replace the `createClient()` call for auth resolution with `resolveRequestUser(request)` from `src/lib/api-auth.ts` (the shared helper introduced for `/api/teams`). No other logic changes.

The authorization check inside the handler that verifies the caller is a team admin (or a profile manager for the managed profile) uses the user-scoped Supabase client returned by `createClient()` to evaluate RLS-governed queries. After the `resolveRequestUser` migration, the handler must construct a per-user Supabase client using `createServiceClientWithUser(userId)` or equivalent — preserving the RLS-based authorization checks. The simplest approach is to keep a user-scoped client for the membership/profile_managers checks and the service role client for the invitation insert (which is the current pattern).

### `POST /api/invitations/[id]/resend` — `apps/web/src/app/api/invitations/[id]/resend/route.ts`

Same change: replace `createClient()` with `resolveRequestUser(request)` for the initial auth check. The team-admin authorization check below it also needs the user-scoped client constructed from the resolved user ID.

Both routes should be added to the `publicRoutes` allowlist in `apps/web/src/lib/supabase/middleware.ts` (`/api/invitations`) following the same pattern as `/api/teams`. Without this, mobile Bearer-token requests are redirected to `/login` before they reach the handler.

---

## New iOS screen — `apps/mobile/app/(app)/invite-member.tsx`

### Routing

Add `invite-member` as a hidden tab in `(app)/_layout.tsx` (using `tabBarButton: () => null`), keeping it within `AppProvider` context. Navigated to with `router.push('/(app)/invite-member')`. An optional `memberId` query param is passed when the screen is opened from a player's detail page (see Guardian invite section below).

### Role selection

The screen opens with a role picker at the top: **Player**, **Manager**, **Coach**. The selected role determines which additional fields are shown below.

### Fields

| Field | Required | Shown for roles | Notes |
|---|---|---|---|
| First name | Yes | All | |
| Last name | Yes | All | |
| Email | Yes | All | |
| Birthday | No | Player only | Date picker |
| Gender | No | Player only | Picker: Male, Female, Non-binary, Prefer not to say |

This mirrors the web `NewMemberForm` exactly. Birthday and gender are optional for players, matching the web form behavior.

### Send logic

1. Retrieve the session token via `supabase.auth.getSession()`
2. `POST /api/invitations/send` with `Authorization: Bearer <token>` and body:
   ```json
   {
     "teamId": "<current team>",
     "email": "...",
     "role": "player|manager|coach",
     "firstName": "...",
     "lastName": "...",
     "birthday": "YYYY-MM-DD",  // player only, optional
     "gender": "..."             // player only, optional
   }
   ```
3. On success: show the confirmation state (see below).
4. On error: display an inline error message (do not dismiss the screen).

### Confirmation state

After a successful send, replace the form with a confirmation view:

- **Email delivered** (`emailSent: true`): Show "Invitation sent to `<email>`." with a "Invite another" button (resets the form) and a "Done" button (pops back to the team roster).
- **Email failed** (`emailSent: false`): Show "Invitation created but we couldn't deliver the email. Share this link instead:" with the invite URL displayed in a copyable text box, a copy button (uses `Clipboard.setStringAsync`), plus the same "Invite another" and "Done" buttons.

### UI

- Back button in the header navigates back without sending.
- "Send invitation" button is disabled while loading; shows "Sending..." during the request.
- Role picker defaults to **Player** (the most common invite type).

---

## Entry point — Team tab header button

Add a `+` icon button to the right side of the Team tab navigation header, visible only when `isAdmin` is true (i.e. `membership?.role === 'coach' || membership?.role === 'manager'`). Tapping it pushes `/(app)/invite-member`.

The button is set via `navigation.setOptions` in the `useEffect` in `apps/mobile/app/(app)/team/index.tsx`, mirroring the pattern used in other tabs. Example:

```tsx
navigation.setOptions({
  title: "Team",
  headerRight: isAdmin
    ? () => (
        <TouchableOpacity onPress={() => router.push("/(app)/invite-member")} style={{ marginRight: 4 }}>
          <Ionicons name="person-add-outline" size={22} color="#0f172a" />
        </TouchableOpacity>
      )
    : undefined,
});
```

The `isAdmin` check must be inside the `useEffect` dependency array (add `isAdmin`) so the header updates when `membership` loads.

---

## Guardian invite — from member detail screen

When an admin views a player's detail screen, a "Contact information" card is shown (mirroring the web `ManagersCard`). This section allows admins to invite a parent or guardian to manage the player.

### Changes to `apps/mobile/app/(app)/team/[memberId].tsx`

**Data fetching** — the existing `fetchData` already loads `profile_managers`. Also load pending guardian invitations for the player:

```ts
supabase
  .from("invitations")
  .select("id, email, role, relationship")
  .eq("team_id", member.team_id)
  .eq("managed_profile_id", member.profile_id)
  .is("accepted_at", null)
```

This is only fetched when `isAdmin` is true.

**"Contact information" card** — rendered below the "Managed by" section (or replacing it when admin). Shows:

- Existing managers (name + relationship + email), read-only.
- Pending invitations as dashed rows: email + relationship badge + "Resend" button.
- An "Add contact" `+` button in the card header (admin only).

**Add contact flow** — tapping "Add contact" opens a bottom sheet (or modal) with two fields:

| Field | Required | Notes |
|---|---|---|
| Email | Yes | |
| Relationship | Yes | Picker: Self, Mom, Dad, Guardian, Other |

On submit, calls `POST /api/invitations/send` with:
```json
{
  "teamId": "<team id>",
  "email": "...",
  "role": "manager",
  "managedProfileId": "<player's profile_id>",
  "relationship": "..."
}
```

On success: show the same email-sent/link-fallback confirmation as the main invite screen. Dismiss the sheet and refresh the detail screen.

**Resend** — tapping "Resend" on a pending invitation calls `POST /api/invitations/<id>/resend` with the Bearer token. Shows a brief inline "Sent" / "Failed" state on the button.

---

## Pending invite resend from team roster

Admins can already see pending invite rows in the team roster (`team/index.tsx`). Currently these rows are non-interactive. Make them tappable for admins: tapping a pending invite row shows an `Alert` with two options:

- **Resend invitation** — calls `POST /api/invitations/<id>/resend` with Bearer token; shows a success/failure `Alert` on completion.
- **Cancel** — dismisses.

This is the iOS equivalent of the web's "Resend" button in the roster.

---

## What is not in scope

- Removing/revoking a pending invitation from the iOS app (can be done on web).
- Editing a pending invitation after it's been sent.
- Inviting via a shareable link without an email address (the API requires an email).
- The accept/join flow for the invitee — already handled by `app/invite/[id].tsx`.
