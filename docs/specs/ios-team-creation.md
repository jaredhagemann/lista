# iOS Team Creation

## Overview

Two entry points into team creation are added to the iOS app:

1. **No-team home screen** — replace the current "ask your coach for an invite link" placeholder with a proper empty state offering both "Create a team" and "I have an invite link" options.
2. **Switcher sheet** — add a "Create a new team" row at the bottom of the Teams section, accessible at any time regardless of whether the user is already on a team.

Both entry points navigate to a new `CreateTeamScreen`.

---

## New screen — `apps/mobile/app/(app)/create-team.tsx`

### Routing

Add `create-team` as a hidden tab in `(app)/_layout.tsx` (using `tabBarButton: () => null` and `tabBarStyle: { display: 'none' }`). This keeps it within the `AppProvider` context without restructuring the layout. It is navigated to with `router.push('/(app)/create-team')` and dismissed back to `/(app)` on success or cancel.

### Fields

Matches the web form:

| Field | Required | Placeholder |
|---|---|---|
| Team name | Yes | e.g. U12 Boys Blue |
| Season | No | e.g. Spring 2026 |
| Club / organization name | No | e.g. Westside FC |

### Creation logic

Mirrors `CreateTeamForm` on the web exactly — uses client-side UUID generation to avoid needing `.select()` after insert (the RLS chicken-and-egg problem: the SELECT policy on `teams` requires a `team_members` row, which doesn't exist at insert time).

Steps, each aborting with an error state on failure:

1. `supabase.from('organizations').insert({ id: orgId, name: orgName || teamName })`
2. `supabase.from('teams').insert({ id: teamId, organization_id: orgId, name: teamName, season: season || null, owner_id: user.id })`
3. `supabase.from('team_members').insert({ team_id: teamId, profile_id: user.id, role: 'coach' })`
4. `supabase.from('profiles').update({ active_team_id: teamId }).eq('id', user.id)`
5. Call `refresh()` from `AppContext` — this re-runs `loadData()`, which will pick up the new membership and resolve `membership` to the new team
6. `router.replace('/(app)')` — lands on the home screen, which will now have a team

### UI

- Back/cancel button in the header (navigates back without creating)
- Submit button disabled while loading, shows "Creating..." text during the async flow
- Inline error message if any step fails
- No success toast needed — the home screen immediately reflects the new team after `refresh()`

---

## Changes to the no-team home screen — `apps/mobile/app/(app)/index.tsx`

Replace the current placeholder (lines 104–118):

```
You're not on a team yet. Ask your coach for an invite link.
```

With a proper empty state:

- Icon: `people-outline` (keep existing)
- Title: "Welcome to Lista"
- Subtitle: "Create a team to get started, or ask your coach for an invite link."
- Primary button: "Create a team" → `router.push('/(app)/create-team')`
- Secondary link: "I have an invite link" → shows an `Alert` with instructions: _"Ask your coach to share the invite link with you. Tap it on your device to join."_ (The existing invite flow is web-URL-based and handled in `app/invite/[id].tsx` — there is no in-app invite entry point to navigate to, so an informational alert is the right approach here.)

---

## Changes to the switcher sheet — `components/SwitcherSheet.tsx`

Add a "Create a new team" row at the bottom of the Teams section (after the team list, before the "View as" divider). The row uses a `+` icon and the same `NavRow`-style layout as the rest of the sheet.

The sheet needs a new `onCreateTeam` prop (callback). Tapping the row calls `onClose()` then `onCreateTeam()`. The parent (`TeamProfileStrip`) passes `() => router.push('/(app)/create-team')`.

---

## What is not in scope

- Team avatar/logo upload at creation time (matches web — logo can be set later in Team Settings)
- Joining a team via invite link from within this flow (handled separately by `app/invite/[id].tsx`)
- Any changes to the web app
