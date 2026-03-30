# iOS App — Team & Profile Switcher Spec

**Status:** In Progress
**Depends on:** Phase 2 complete
**Target:** Implement before Phase 3

---

## Problem

The mobile app currently uses `useActiveMembership` per-screen to resolve the active team and profile. There is no way for the user to:
- See which team/profile they are currently viewing
- Switch to another team they belong to
- Switch to a managed profile (e.g., a parent viewing as their child)

This mirrors the gap that was addressed in the web app with the Team Switcher and Profile Switcher components in the dashboard nav.

---

## Design

### Persistent header strip

A compact strip rendered above the tab bar content on all app screens. It is always visible and provides at-a-glance context.

```
┌──────────────────────────────────┐
│  [TL]  Thunder Lightning U12  ⌄  │  ← normal state
└──────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  [TL]  Thunder Lightning U12  ·  Viewing as: Jake  ⌄ │  ← managed profile active
└──────────────────────────────────────────────────────┘
```

- **Left**: Team initials avatar (2 letters, colored circle) or team logo if set
- **Center**: Team name. If viewing a managed profile, shows "Viewing as: [first name]"
- **Right**: Chevron-down icon
- **Tapping anywhere** on the strip opens the switcher bottom sheet

### Switcher bottom sheet

A modal that slides up from the bottom when the strip is tapped. Two sections:

#### Section 1 — Teams
Lists every unique team accessible to the current user (their own memberships + memberships of their managed profiles), deduplicated by team ID. Each row shows:
- Team initials avatar
- Team name + season
- User's role on that team (or "2 profiles" if multiple profiles on same team, matching web behavior)
- Checkmark on the currently active team

Tapping a team row calls `switchTeam(teamId)`, closes the sheet, and refreshes all screens.

A **"+ Create new team"** row appears at the bottom of the teams section (Phase 5 concern — placeholder for now, can show a "coming soon" toast).

#### Section 2 — View as (conditional)
Only shown when the active team has more than one of the user's profiles on it (e.g., the parent is also a team member, or has multiple managed players on the same team).

Lists all profiles on the active team that the current user owns or manages:
- Own profile row: name + role + "(you)" tag
- Managed profile rows: name + role + relationship tag (e.g., "Son", "Daughter")
- Checkmark on the currently active profile

Tapping a profile row calls `switchProfile(profileId, teamId)`, closes the sheet, refreshes all screens.

---

## State & Storage

| Concern | Web | Mobile |
|---------|-----|--------|
| Active profile ID | HttpOnly cookie `active_profile_id` | `expo-secure-store` key `active_profile_id` (already used by `useActiveMembership`) |
| Active team ID | `profiles.active_team_id` (DB column) | Same — update via Supabase upsert |
| "Own profile" default | Cookie absent → use `auth.uid()` | SecureStore absent → use `session.user.id` |

Switching logic mirrors the web server actions exactly:
- **switchTeam(teamId)**: find which of user's profiles is on that team (prefer own profile, fall back to first managed profile) → update that profile's `active_team_id` in Supabase → update SecureStore `active_profile_id`
- **switchProfile(profileId, teamId)**: validate profile is own or managed → update profile's `active_team_id` → update SecureStore

Both operations update the Supabase `profiles` row directly using the **anon key** (not service role — the user's own JWT has UPDATE permission on their own profile and managed profiles via `is_managed_by_me()`). If a permission issue arises with managed profiles, a thin web API route (`/api/profile/switch`) can proxy with the service role key, same pattern as signup.

---

## App Context (replaces `useActiveMembership`)

A new `AppContext` is introduced at the `(app)` layout level. All screens consume context instead of calling the hook individually. This eliminates duplicate fetches on every tab switch and provides a single place to trigger refresh after a switch.

### Context shape

```ts
type AppContextValue = {
  // Current state
  ownProfile: Profile | null;
  activeProfile: Profile | null;       // may differ from ownProfile
  membership: ActiveMembership | null; // active team + role
  allMemberships: TeamMemberRow[];     // all teams (own + managed)
  profilesOnActiveTeam: TeamMemberRow[]; // for "View as" section

  // Loading
  loading: boolean;

  // Actions
  switchTeam: (teamId: string) => Promise<void>;
  switchProfile: (profileId: string, teamId: string) => Promise<void>;
  refresh: () => Promise<void>;
};
```

### Data fetched once on mount (in `AppProvider`)

Mirrors the web dashboard layout RSC queries, but client-side:

1. Read `active_profile_id` from SecureStore → fall back to `session.user.id`
2. Fetch own `profiles` row
3. Fetch managed profiles via `profile_managers WHERE manager_id = uid`
4. Fetch all `team_members` (own + managed profile IDs) with `teams(*)` joined
5. Derive `activeProfile`, `activeMembership`, `profilesOnActiveTeam` in memory

All screens that currently call `useActiveMembership` are updated to use `useAppContext()` instead.

---

## File Structure

```
apps/mobile/
├── contexts/
│   └── AppContext.tsx          ← Provider + useAppContext hook
├── components/
│   └── TeamProfileStrip.tsx    ← Persistent header strip
│   └── SwitcherSheet.tsx       ← Bottom sheet modal
├── app/
│   └── (app)/
│       └── _layout.tsx         ← Wraps content with AppProvider + renders strip
```

### Changes to existing files

| File | Change |
|------|--------|
| `app/(app)/_layout.tsx` | Wrap tab content in `<AppProvider>`, render `<TeamProfileStrip>` above `<Tabs>` |
| `app/(app)/index.tsx` | Replace `useActiveMembership` with `useAppContext()` |
| `app/(app)/schedule/index.tsx` | Replace `useActiveMembership` with `useAppContext()` |
| `app/(app)/schedule/[eventId].tsx` | Replace `useActiveMembership` with `useAppContext()` |
| `hooks/useActiveMembership.ts` | Keep for now, deprecated — context replaces it |

---

## Decisions

1. **Bottom sheet library**: Plain `Modal` with slide-up animation. No new dependency.
2. **Team logo**: Show `logo_url` image when set; fall back to initials circle.
3. **Create new team**: Deferred to Phase 5. The option will not appear in the switcher until team creation is built in Settings.
4. **Profile with no team**: Strip shows "No team" placeholder; switcher sheet is empty (no team rows).

---

## Implementation Plan

### Step 1 — AppContext
- Create `contexts/AppContext.tsx` with provider and hook
- Implement `switchTeam` and `switchProfile` mutations
- Verify SecureStore + Supabase round-trip works

### Step 2 — Strip + Sheet UI
- Create `components/TeamProfileStrip.tsx`
- Create `components/SwitcherSheet.tsx` (plain Modal, slide-up animation)
- Wire up to `(app)/_layout.tsx`

### Step 3 — Migrate screens
- Update `index.tsx`, `schedule/index.tsx`, `schedule/[eventId].tsx` to consume context
- Remove per-screen `useActiveMembership` calls
- Verify switching updates all tab screens instantly (context re-renders consumers)

---

*This spec is ready for review. No code changes have been made.*
