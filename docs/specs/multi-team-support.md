# Multi-Team Support

## Problem

The database schema already supports a user belonging to multiple teams (via `team_members`), but the application hardcodes `.limit(1)` on every dashboard page and displays `memberships[0]` in the nav. A coach managing three teams sees only the first one they joined with no way to switch or create new ones.

---

## Goals

- Allow a user to belong to multiple teams and switch between them
- Allow any user to create a new team from within the dashboard
- Keep the single-team-at-a-time view model (no aggregated cross-team views)
- Persist the active team selection across sessions and devices

---

## What Already Works (No Changes Needed)

- **Database schema** — `team_members` already links profiles to multiple teams. All RLS policies are team-scoped and will work correctly once the active team is properly selected.
- **Event detail pages** — use `event.team_id` directly, already multi-team safe.
- **Notification system** — already team-scoped.
- **Invitation flow** — already team-scoped.

---

## Data Model Changes

### 1. Add `active_team_id` to `profiles`

```sql
alter table profiles
  add column active_team_id uuid references teams(id) on delete set null;
```

This persists the user's last selected team across devices and sessions. It is validated on load — if the value is null or the user is no longer a member of that team, the app falls back to the first team in their membership list and updates the column accordingly.

**Why not a cookie?** A cookie works within a single browser but would reset on every new device or browser. Storing it in the profile gives cross-device consistency with no extra complexity since the profile is already fetched on every dashboard load.

**Why not URL-based routing (`/dashboard/[teamId]/...`)?** URL-based routing is the most architecturally correct approach but requires restructuring every dashboard route and every link in the app. It would also expose team UUIDs in the URL. Given the usage pattern (coaches switch teams occasionally, not constantly), session-based active team selection is the better tradeoff for now. URL-based routing can be revisited if deep-linking to specific teams becomes a requirement.

### No other schema changes required

The `organizations` table will remain an implementation detail. Users think in terms of teams, not organizations. The 1:1 org-per-team model created today can stay — orgs are not surfaced in the UI.

---

## User Flows

### Switching Teams

1. User opens the dashboard — the nav shows their active team name, logo, and role.
2. User clicks the team name/logo area in the nav — a dropdown opens listing all teams they belong to, showing name, sport, and their role on each.
3. User selects a different team — the app updates `profiles.active_team_id` via a server action and reloads the dashboard in the context of the new team.
4. All dashboard pages (schedule, availability, team roster, settings) now show data for the selected team.

### Creating a New Team

1. At the bottom of the team switcher dropdown there is a **"Create new team"** option.
2. Clicking it opens the existing team creation form (currently only accessible pre-dashboard).
3. On successful creation the user is automatically switched to the new team.
4. The new team appears in the switcher dropdown on all future visits.

### First Visit / No Active Team

If `active_team_id` is null (new user who just confirmed their email but hasn't joined or created a team yet):

- The dashboard home shows an empty state prompting the user to either create a team or check their email for a pending invitation.
- No schedule, team, or availability pages are accessible until a team is selected.

### Joining via Invite

This flow is unchanged. After accepting an invite the user lands on the dashboard. If they have no active team set, the newly joined team becomes the active team automatically.

---

## Component Changes

### Dashboard Layout (`src/app/dashboard/layout.tsx`)

- Continue fetching all `team_members` with joined `teams` data for the current user.
- Determine the active team: use `profile.active_team_id` if set and valid (user is still a member), otherwise fall back to `memberships[0]`.
- If the fallback is used, update `profiles.active_team_id` to match.
- Pass `activeTeam`, `activeMembership`, and `allMemberships` down to the nav and children via props.

### Dashboard Nav (`src/components/layout/dashboard-nav.tsx`)

Replace the static team display with a **TeamSwitcher** component:
- Shows active team name, logo (or placeholder), and current user role.
- Opens a dropdown listing all teams (name, sport/age group, role).
- Highlights the currently active team.
- "Create new team" option at the bottom of the list.
- On selection, calls a server action to update `active_team_id` and navigates back to `/dashboard`.

### Dashboard Pages (all pages under `src/app/dashboard/`)

- Remove the `.limit(1).single()` pattern.
- Receive `teamId` from the layout (passed as a prop or via a shared context) instead of fetching it independently.
- No logic changes beyond where `teamId` comes from.

### Team Creation Form (`src/components/team/create-team-form.tsx`)

- Move or adapt it to be accessible from within the dashboard (triggered from the team switcher).
- After creation, call the server action to set the new team as active.

### Server Action: `setActiveTeam(teamId)`

A new server action that:
1. Validates the requesting user is a member of `teamId`.
2. Updates `profiles.active_team_id` for the current user.
3. Revalidates the dashboard path so the layout re-fetches with the new active team.

---

## RLS Considerations

The new `active_team_id` column on `profiles` must be writable by the profile owner:

```sql
-- existing policy already allows users to update their own profile
-- verify it covers the new column, or extend it:
create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

No new RLS policies are needed on any other table — all existing policies are already team-scoped and will correctly filter data based on whichever `team_id` the dashboard passes.

---

## Out of Scope (for now)

- **Organizations UI** — orgs remain a hidden implementation detail.
- **Cross-team aggregated views** — e.g. "all my events across all teams this week." Single-team view only.
- **URL-based team routing** — e.g. `/dashboard/teams/[teamId]/schedule`. Can be revisited later.
- **Team archiving / leaving a team** — separate feature.
- **Roles per team in the switcher beyond display** — the switcher shows role as context but doesn't gate features differently per team beyond what RLS already enforces.
