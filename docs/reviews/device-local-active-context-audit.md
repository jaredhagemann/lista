# Device-local active profile and team: implementation audit

Audit date: October 16, 2026. Checkout: `d26982c67`. Legacy comparison: `ios-v1.0.12` (`b3473c71bb9c456f4d92e76e87b3f6b939c8cff7`).

This is an implementation inventory, not an implemented change. No application code or database was changed. Findings come from local source, migration history, the tagged iOS source, and existing focused unit/component tests. Production behavior and the installed 1.0.12 binary were not exercised.

## Verified current behavior

| Concern | Web | Mobile |
| --- | --- | --- |
| Active profile | `active_profile_id` cookie | SecureStore `active_profile_id` |
| Active team | `profiles.active_team_id` | `profiles.active_team_id` |
| Team switch writes | `app/actions/team.ts:75` updates the chosen profile through the service-role client | `contexts/AppContext.tsx:222` updates the chosen profile through Supabase |
| Profile switch writes | `app/actions/profile.ts:43` updates the destination profile's team | `contexts/AppContext.tsx:241` updates the destination profile's team |
| Resolution | Dashboard layout has its own implementation; shared helper and club/training pages have additional implementations | `AppContext` loads profile data, then derives membership using `activeProfile.active_team_id` |

Changing the selected person is local, but the switch can also change the destination person's shared team preference. Another device or guardian displaying that profile can pick up the team change when its context is read/refreshed. Mobile does not subscribe to realtime profile changes in `AppContext`; this is not necessarily an instantaneous visual change on another phone.

The reported 16 web files containing `active_team_id` is correct, excluding generated database types. They are not 16 readers: there are 12 files that read/resolve selection, three selection writers, and one archive cleanup writer. Additional files without that string must change to preserve creation and invitation behavior.

`apps/mobile/hooks/useActiveMembership.ts` has no imports/callers in the repository. Updating it is not sufficient and is not required for current screens. Remove it or delegate it to the provider to avoid preserving a second, obsolete resolution path.

## Recommended behavior and storage contract

1. Store a versioned local context containing the authenticated account ID, selected profile ID, and selected team ID. A single validated tuple satisfies device isolation; a map remembering each profile's previous team is an optional product enhancement, not a prerequisite.
2. On web, use a new canonical HTTP-only context cookie, with common options for switches, invitations, creation, and clearing. Scope it to `.lista.team` in production when subdomain routing is enabled, and to the current host in development/staging. Tabs sharing a browser cookie jar will share context; separate browsers and app installations will not.
3. On mobile, use an account-specific SecureStore key for the same tuple. Update in-memory context after a successful local write. Validate ownership and membership against newly loaded data; ignore stale async results after an account change and reset displayed state when the session ends/changes.
4. During migration/first initialization only, consider the legacy local profile selection and the selected profile's database team preference. Validate them, apply the existing own/managed fallback, and persist the resolved tuple locally. The profile used for the UI and the profile used for membership must be the same, including parent-only accounts.
5. Once local context exists, an invalid or revoked membership must fall back to a deterministic authorized local selection rather than re-reading the shared database preference. Deletion, archive, removed guardian links, no teams, malformed storage, and another account's tuple all need explicit handling. Persist repaired selection at a writable boundary; do not overwrite good storage after a transient query failure.
6. Browsing switches stop writing `profiles.active_team_id`. Retain that column, its permissions, database creation/invitation writes, and cleanup behavior for legacy clients and initial seeding.

Profile readability is not permission to act as that profile: teammates' profiles are readable under RLS. Resolve own/managed eligibility explicitly before resolving membership, especially if a service-role client is involved. Preserve existing team/org authorization and subscription gates independently of the local selection.

The canonical tuple avoids mismatched independent profile/team values. Keeping `active_profile_id` as the canonical profile plus an account/profile-bound team cookie is another valid implementation, but requires handling existing same-name host/domain cookies consistently. With a new cookie, read legacy selection only while bootstrapping, then ignore it. Remove reachable obsolete host/domain cookies when practical.

## Web change inventory

All paths below are relative to `apps/web/src/`. This is a concrete recommended layout; file splits can vary.

| File(s) | Required work |
| --- | --- |
| New `lib/active-context.ts` | Resolve a coherent account/profile/team/membership from authenticated ownership links, visible memberships, local context, and initialization-only legacy defaults. Share the logic with dashboard layout and the existing membership/profile helper APIs. |
| New `lib/active-context-cookie.ts`; `app/actions/constants.ts` | Parse/version the canonical cookie, centralize options, and write/clear tuples. Include account binding, limits/validation, migration and legacy-cookie cleanup. |
| `lib/get-active-membership.ts` | Delegate `getActiveMembership` and `getActiveProfileId` to the same validated context. Keep wrapper signatures if useful; otherwise update the two direct external profile-helper callers. |
| `lib/supabase/middleware.ts` | Provide a writable first-page initialization/repair boundary after authentication for dashboard page requests. Forward the resolved cookie/context into the downstream request and set it on the response so the first render agrees. Preserve auth refresh cookies and headers. Exclude team-switch route handlers and server-action POSTs from conflicting initialization. An explicit initialization route is a valid alternative if preferred. |
| `app/actions/team.ts` | In `setActiveTeam`, keep own/managed membership validation and redirect rules, replace the profile-row update with local context persistence. Revisit `clearActiveProfile`: creation should select its returned team explicitly instead of clearing profile and relying on the DB. Other team mutation functions remain unrelated. |
| `app/actions/profile.ts` | In `setActiveProfile`, keep own/managed and team-membership checks; replace the profile-row update and separate cookie writes with the canonical tuple. |
| `app/dashboard/layout.tsx` | Use the shared resolved tuple for active profile, membership, branding, nav, and subdomain routing. Keep all-membership loading for switchers; avoid showing the parent's profile while resolving a child's fallback membership. |
| `app/dashboard/club/layout.tsx`; `app/dashboard/club/page.tsx`; `app/dashboard/club/teams/page.tsx`; `app/dashboard/club/members/page.tsx`; `app/dashboard/club/settings/page.tsx`; `app/dashboard/club/branding/page.tsx`; `app/dashboard/club/billing/page.tsx` | Replace each raw profile cookie/DB-team preamble with validated local membership/context. Preserve authenticated-user org-role checks, plan gates, and owner-only billing behavior. |
| `app/dashboard/training/page.tsx` | Resolve the active profile and team together from local context. Keep viewer authorization distinct from the player being viewed and retain eligible-training-team checks. |
| `app/dashboard/settings/page.tsx` | Use that same context for the training opt-out profile/org, not the second raw cookie/DB lookup. The Plan tab already uses `getActiveMembership`. |
| `app/api/teams/route.ts` | Keep the `create_team` RPC and `{ teamId }` response. On authenticated browser creation, persist own-profile/new-team context. A Bearer request cannot establish the mobile device's SecureStore selection. |
| `app/api/club/teams/route.ts` | Keep legacy DB preference write, enrollments, and existing success fields/status; persist browser local selection after verifying creator membership exists. Add `teamId` to the response if needed for client routing. Enrollment failure is currently nonfatal, so don't blindly save an invalid tuple. |
| `lib/create-team.ts`; `components/team/create-team-form.tsx` | Replace clear-profile-only success semantics with explicit new-team selection; consume returned identity/context or rely on the server API cookie write consistently. Ensure the existing-club branch selects own profile too. Do not clear the just-written canonical tuple after the API response. |
| `app/actions/invite.ts` | All acceptance modes must persist the returned profile/team locally: self/director uses own profile; guardian/manager uses `managedProfileId`. Handle a director invitation with no landing team. Current manager-only cookie handling is insufficient. |
| `app/api/invite/[id]/accept/route.ts` | Preserve request fields and `success`; add returned `teamId` and `managedProfileId` for updated mobile callers to save local context. If browser callers use this endpoint, persist their context too. |

The table names 23 web source files, including two new helpers. It is a recommended implementation inventory, not a claim that a refactor must touch exactly that many files.

Existing helper consumers such as dashboard/home, schedule, roster, chat, and availability inherit the behavior through `getActiveMembership`. The direct `getActiveProfileId` callers are `app/dashboard/team/[memberId]/page.tsx` and `removeTeamMember` in `app/actions/team.ts`; preserve their behavior and validate the helper, adapting call sites if its signature changes.

Keep regression coverage for `app/dashboard/switch-team/route.ts` and `app/dashboard/club/open/route.ts`: they already call `setActiveTeam`, so they need no separate persistence implementation. Event links must preserve the requested page/query through a team switch and subsequent club-host redirect.

### API and cleanup exceptions

- `app/api/billing/status/route.ts` is a legacy default resolver, not a normal dashboard context reader. It supports explicit `?orgId=`, authenticates cookie or Bearer callers, and uses the authenticated account's org role. No production caller was found in this checkout. Keep its DB-based no-parameter default for backward compatibility and have new callers provide `orgId`. If cookie-based default behavior is deliberately changed, branch by authenticated request context and test it separately; do not feed an unvalidated cookie to its admin client.
- `app/api/club/teams/[id]/archive/route.ts` should keep clearing the legacy DB preference. That cannot clear cookies/SecureStore on other devices; the new resolver must reject/fallback from invalid local choices. Existing database access allows org admins to view archived teams, so preserve that authorization while defining whether an archived team remains the current browsing selection. A conservative product choice is to move the current context to an unarchived eligible team while retaining explicit archive views.

## Mobile change inventory

All paths below are relative to `apps/mobile/`.

| File | Required work |
| --- | --- |
| New `lib/active-context.ts` | Versioned account-specific SecureStore codec/read/write/migration. Export a helper usable outside `AppProvider`, since the invitation screen is outside its route group. |
| `contexts/AppContext.tsx` | Load and validate local selection, seed only when absent, derive membership from local team, remove both profile-row writes, save validated switch tuples, keep the active profile and membership coherent, and handle session/async-load transitions. |
| `lib/create-team.ts` | Read `{ teamId }` and save own-profile/new-team context before `refresh`, replacing the existing legacy-key-only reset. |
| `app/(app)/create-team.tsx` | Supply the authenticated account/local-context persistence dependency required by the revised creation helper. |
| `app/invite/[id].tsx` | Consume the additive acceptance response and persist the returned selected person/team before returning to the app. Do not assume an `AppProvider` is mounted here. |
| `hooks/useActiveMembership.ts` | Optional cleanup: remove the unused implementation or adapt it to the authoritative context. It is not a live second consumer today. |
| `DEVELOPMENT.md` | Update the documented storage and switching behavior. |

This requires a new mobile release. `app.json` already declares `1.1.0`; EAS uses remote app-version management. No `expo-updates` dependency/configuration was found, so there is no configured OTA path to assume here. The final version/build number is a release decision.

## Database and 1.0.12 compatibility

No schema migration or new table is needed for this design. Repository SQL references to `active_team_id` define the column, write creation/invitation defaults, or clear stale defaults; no access-control function/policy found depends on it as the selected browsing context.

Keep the `create_team`, `create_club_team`, and `accept_invitation` RPC contracts/writes, profile update permissions, FK `ON DELETE SET NULL`, director-removal cleanup, and archive cleanup. This preserves existing defaults for clients that still use the column.

The tagged 1.0.12 app directly reads and updates the shared column in its provider. Its team-creation helper consumes the existing API success status and clears `active_profile_id`; its invitation screen sends `{ type: "self" | "manager" }` and reads `error` on failure. Keeping these fields/statuses while adding successful-response fields is source-compatible.

The claim must be limited: the change can preserve the old app's contracts, but cannot make installed 1.0.12 clients device-local. Two old clients can still affect each other. A migrated client must ignore subsequent database preference changes after local initialization. Browser state reset/new installation is a fresh initialization and can still inherit the then-current legacy default.

One invitation detail matters: in the current guardian RPC branch, the DB preference is written on the guardian's profile, not the child's. Use the RPC's returned `managed_profile_id` and `team_id` for local landing context instead of inferring the selected child from that column.

## Verification performed

Existing baseline tests all passed:

- Web: 167 tests across 14 files: `set-active-team`, `create-team-form`, `create-team-form-component`, `event-link-other-team`, `dashboard-layout-branding`, `subdomain-redirect-keeps-page`, `status-api`, `profile-actions`, `invite-accept-api`, `director-invite-accept`, `api-teams`, `club-api`, `middleware`, and `api-auth`.
- Mobile: 24 tests across `SwitcherSheet`, `create-team-logic`, and `invite-accept`.
- The `club-api` enrollment-failure test intentionally logs its mocked duplicate-key error and passes.

These establish a baseline, not proof that the proposed implementation works. No live Supabase/RLS integration, browser E2E suite, iOS simulator, or installed 1.0.12 build was run. No database reset or remote mutation was performed.

## Acceptance coverage required for the change

1. Independent browser contexts, the same account and same child, different teams; switching A leaves B's saved selection and DB preference unchanged.
2. Different guardians managing one child; one's switch leaves the other's local context unchanged.
3. Daughter/son switching, self/managed switching, a parent with no direct team row, no memberships, removed guardian links, removed team membership, deleted teams, and archived teams under existing role rules.
4. First migration seeds once; subsequent legacy-client DB writes do not change migrated clients, including after reload/relaunch. Invalid saved selections do not repeatedly adopt global preferences.
5. Own and managed profile cookies cannot be forged into acting as a readable teammate; account A's state is rejected on account B. Mobile loads finishing after an account change cannot publish stale state.
6. Main domain, `www`, two club subdomains, staging, and localhost use coherent cookie options. Legacy host/domain duplicates do not override canonical state. Event/club deep links retain their destination.
7. Team creation and every invitation acceptance mode land on the returned profile/team despite an existing saved selection. Zero-team director invitations and nonfatal club enrollment failure do not save invalid context.
8. API requests matching 1.0.12 continue working; additive response fields preserve success/error contracts. Keep DB-based API compatibility tests where legacy defaults are intentional.
9. Exercise the real mobile `AppProvider` with mocked storage/database, not only a switcher component with a mocked context. Cover local-storage failures and concurrent refresh/switch/account transitions.
10. Update browser E2E setup that currently controls selection by writing `profiles.active_team_id`, particularly `tests/e2e/team-deletion.spec.ts`; use browser context/cookies or actual switching once a browser is initialized. Keep DB-seeded defaults in tests specifically covering first migration.

Expected scope remains moderate: a cross-cutting web refactor plus a smaller mobile change, with focused migration and isolation tests. Two PRs are a reasonable delivery split, with additive server API support deployed before the updated mobile build.
