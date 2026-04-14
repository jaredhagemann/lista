# iOS — Invite Members

## Overview

Coaches and managers can send team member invitations directly from the iOS app, mirroring the web invite flow at `/dashboard/team/new`. Two distinct invite paths exist:

1. **New team member invite** — invite someone who is not yet on the team (player, coach, or manager). Entry point: a "+" button in the Team tab header, visible only to admins.
2. **Guardian/manager invite for an existing player** — invite a parent or guardian to manage an existing player profile. Entry point: an "Add contact" button on the player's member detail screen, visible only to admins.

Both paths call the existing `POST /api/invitations/send` endpoint, which needs to be updated to accept Bearer token authentication so it is callable from the iOS app.

---

## Migration dependency — tighten invitations SELECT policy

**This migration must be applied before any iOS screen queries the `invitations` table client-side.**

The existing "Invited users can view own invitation" RLS policy contains an `accepted_at is null` branch that grants every authenticated user read access to all pending invitations across all teams. Every code path that legitimately needs to read an invitation without the invitee being signed in (the `/api/invite/[id]` route, the web invite page, the mobile invite screen) uses a service-role client that bypasses RLS, so the clause was never doing useful work — it was only leaking invitee names, email addresses, roles, and relationship metadata to any signed-in user.

**Migration: `supabase/migrations/20260414000000_fix_invitations_select_policy.sql`**

Drop and recreate the policy, removing the `accepted_at is null` branch:

```sql
drop policy if exists "Invited users can view own invitation" on invitations;

create policy "Invited users can view own invitation"
  on invitations for select using (
    email = (auth.jwt() ->> 'email')
  );
```

After this migration the two SELECT policies on `invitations` are:

| Policy | Who can read |
|---|---|
| Invitations visible to team admins | Any `coach` or `manager` on the invitation's `team_id` — via `is_team_admin(team_id)` |
| Invited users can view own invitation | The user whose email matches the invitation's `email` field |

The guardian invite query on the member detail screen (filtered by `managed_profile_id`) is correctly gated by the first policy: only coaches and managers of the team will have rows returned. No server endpoint is needed — client-side Supabase queries are sufficient once this policy is in place.

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

Add `invite-member` as a hidden tab in `(app)/_layout.tsx` (using `tabBarButton: () => null`), keeping it within `AppProvider` context.

The screen has two modes, selected by query params:

- **General invite** (no params): `router.push('/(app)/invite-member')` — shows role picker, all fields. Entry point: Team tab header button.
- **Guardian invite** (`memberId=<team_member_id>`): `router.push({ pathname: '/(app)/invite-member', params: { memberId } })` — hides the role picker (role is fixed to `manager`), shows relationship field instead. Entry point: "Add contact" button on `[memberId].tsx`.

Both modes share the same screen, send logic, and confirmation state. The `memberId` param is used to look up `profile_id` and `team_id` for the API call.

### Role selection

In **general invite** mode, the screen opens with a role picker at the top: **Player**, **Manager**, **Coach**. The selected role determines which additional fields are shown below.

In **guardian invite** mode, the role picker is not rendered. The role is fixed to `manager` and a relationship picker is shown instead (see Guardian invite section below).

### Fields

**General invite mode:**

| Field | Required | Shown for roles | Notes |
|---|---|---|---|
| First name | Yes | All | |
| Last name | Yes | All | |
| Email | Yes | All | |
| Birthday | No | Player only | Date picker |
| Gender | No | Player only | Picker: Male, Female, Non-binary, Prefer not to say |

This mirrors the web `NewMemberForm` exactly. Birthday and gender are optional for players, matching the web form behavior.

**Guardian invite mode** (when `memberId` param is present):

| Field | Required | Notes |
|---|---|---|
| Email | Yes | |
| Relationship | Yes | Picker: Self, Mom, Dad, Guardian, Other |

First name and last name are omitted — the player profile already exists; the invitation is for the guardian, not the player.

### Send logic

1. Retrieve the session token via `supabase.auth.getSession()`
2. `POST /api/invitations/send` with `Authorization: Bearer <token>` and body:

   **General invite:**
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

   **Guardian invite** (resolve `profile_id` and `team_id` from the `memberId` param before sending):
   ```json
   {
     "teamId": "<team id from member row>",
     "email": "...",
     "role": "manager",
     "managedProfileId": "<profile_id from member row>",
     "relationship": "..."
   }
   ```

3. On success: show the confirmation state (see below).
4. On error: display an inline error message (do not dismiss the screen).

### Confirmation state

After a successful send, replace the form with a confirmation view:

- **Email delivered** (`emailSent: true`): Show "Invitation sent to `<email>`." with an "Invite another" button (resets the form) and a "Done" button.
- **Email failed** (`emailSent: false`): Show "Invitation created but we couldn't deliver the email. Share this link instead:" with the invite URL displayed in a copyable text box, a copy button (uses `Clipboard.setStringAsync`), plus the same "Invite another" and "Done" buttons.

"Done" pops back one screen in both modes — back to the team roster in general invite mode, back to the member detail screen in guardian invite mode. "Invite another" resets the form and stays on the screen; in guardian invite mode it keeps the `memberId` param context so the next invite is also a guardian invite for the same player.

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

When an admin views a player's detail screen, a "Contact information" card is shown (mirroring the web `ManagersCard`). Tapping "Add contact" pushes `invite-member` in guardian invite mode — no separate bottom sheet or modal is needed.

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

RLS enforces that only team admins can read these rows (see migration dependency above) — no `isAdmin` UI guard is needed to protect this query, though the "Contact information" card and "Add contact" button are still only rendered when `isAdmin` is true for UX reasons. Call `fetchData` on `useFocusEffect` (not just `useEffect`) so the card refreshes automatically after returning from the invite screen.

**"Contact information" card** — rendered below the existing "Managed by" section when `isAdmin` is true (admins see both; non-admins continue to see only "Managed by" as before). Shows:

- Existing managers (name + relationship + email), read-only.
- Pending invitations as dashed rows: email + relationship badge + "Resend" button.
- An "Add contact" button in the card header (admin only): `router.push({ pathname: '/(app)/invite-member', params: { memberId } })`.

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
