# Spec — The active profile and team are per device

**Status:** Decided 2026-10-16 (§4, D1–D7). **Web built** (§9, PR 1), in review. Mobile next.
**Requested:** 2026-10-16, by the user. It ships in mobile **1.1.0**, which waits for it (D7).
**Scope:** web and the mobile app. No database migration.
**Reference:** [Implementation audit](../reviews/device-local-active-context-audit.md) (Codex, 2026-10-16,
at `d26982c67`). It has the file-by-file inventory, the compatibility analysis and the acceptance list. This
spec settles the product rules; the audit is the build checklist.

## 1. What's wanted

A parent switches, in their browser, from their daughter's club team to their son's rec league team. **No
other browser or phone should change.** Not their own phone, and not the other parent's, who manages the same
children. Each device keeps its own choice of whom it's viewing as and which team.

## 2. Today

- **Which person is shown is already per device.** On the web it's the `active_profile_id` cookie. On mobile
  it's the SecureStore key `active_profile_id`.
- **Which team is shown is shared.** It's `profiles.active_team_id`, a column on the person's profile. Every
  switch writes it:
  - web: `app/actions/team.ts` and `app/actions/profile.ts`
  - mobile: `contexts/AppContext.tsx`, `switchTeam` and `switchProfile`
- **So a switch can move other devices.** Any device showing that person, including another guardian's, picks
  up the new team the next time it reads its context. Mobile has no realtime subscription to this, so another
  phone changes on its next load, not instantly.
- **The resolution is scattered.** The web resolves the context in the dashboard layout, in
  `get-active-membership.ts`, and again in the club, training and settings pages. Several of those read the
  profile cookie without checking it belongs to the user. Mobile resolves it in `AppContext` only;
  `hooks/useActiveMembership.ts` has no callers.

## 3. The rule

**A device remembers its own context: the account, the person viewed as, and the team, kept together.**
- A switch changes only that device's context.
- The database's team preference becomes a **"last picked" default**. It's only read when a device has no
  valid context of its own (D2, D3).
- Tabs in one browser share a cookie, so they share a context. Separate browsers, and the app on each phone,
  don't.

## 4. Decisions

| # | Question | Decision |
| --- | --- | --- |
| D1 | What is stored per device? | **One tuple: account id, profile id and team id**, versioned. On the web, a new HTTP-only cookie. On mobile, a SecureStore key specific to the account. A tuple for another account is ignored (audit, "Recommended behavior" 1–3). |
| D2 | Which team does a device with no saved context open to: a new phone, a cleared browser, or the first load after this ships? | **The last team picked anywhere.** Switches keep writing `profiles.active_team_id` as that default, but no device with its own valid context reads it. Without a usable default, the device uses the existing fallback: the own profile's first membership, else the first managed profile's (decided 2026-10-16). |
| D3 | A saved team the account no longer belongs to: membership removed, team deleted, guardian link removed? | **The device falls back as in D2,** then **saves the result**, so it doesn't keep re-adopting the shared default. A failed read is not a reason to overwrite good storage (decided 2026-10-16). |
| D4 | An archived team as the saved context? | **Treated as in D3:** the device moves to an unarchived team the account can see. Org admins keep their explicit archive views (audit, "API and cleanup exceptions"). |
| D5 | Creating a team, or accepting an invitation? | **The device lands on the new team, as the person it's for:** its own profile for a team or director invitation, the child for a guardian invitation. It saves that context whatever was saved before. A director invitation with no team, or a club enrollment that failed, saves nothing invalid (audit, items 7 and the invitation detail). |
| D6 | Can a saved context make the device act as someone else? | **No.** The profile must be the user's own or one they manage, and the team one that profile belongs to, checked at every read. Being able to see a teammate's profile is not permission to act as them. |
| D7 | Release | **Web first,** with the additive API fields mobile needs. **Then mobile, in 1.1.0.** The 1.1.0 tag waits for it (decided 2026-10-16). |

## 5. Web

Following the audit's web inventory:
- **One resolver,** `lib/active-context.ts`, used by the dashboard layout, `get-active-membership.ts`, and the
  club, training and settings pages. They stop reading the cookie or `active_team_id` themselves.
- **One cookie module,** `lib/active-context-cookie.ts`, for parsing, versioning, options and clearing. The
  cookie domain is `.lista.team` in production with subdomain routing, and the current host elsewhere.
  `active_profile_id` is read once, to seed the first context, then ignored and cleared where it can be.
- **The first page load seeds the context and saves it** (D2), in the middleware or an explicit init route.
  The first render must agree with the saved cookie.
- **Switches** (`setActiveTeam`, `setActiveProfile`) keep their membership checks, save the tuple, and write
  `active_team_id` only as the D2 default.
- **Creation and invitations** save the landing context (D5). The accept API adds `teamId` and
  `managedProfileId` to its success response, for mobile.
- **API exceptions:** `api/billing/status` keeps its database-based default. The archive route keeps clearing
  `active_team_id`.

## 6. Mobile

Following the audit's mobile inventory:
- **`lib/active-context.ts`:** the SecureStore codec, plus the one-time seed from the legacy key and the D2
  default. It's usable outside `AppProvider`, for the invitation screen.
- **`AppContext.tsx`:**
  - reads and validates the saved context, and derives the membership from its team
  - saves validated switches, and stops reading `active_team_id` once it has a context
  - ignores loads that finish after the account changes, and resets on sign-out
- **Team creation and the invitation screen** save the returned context (D5).
- **`hooks/useActiveMembership.ts`** is removed. `DEVELOPMENT.md` describes the new storage.

## 7. Compatibility

- **No migration.** The column, its permissions, and the database functions that write it on team creation
  and invitation acceptance all stay. So do the cleanups on delete and archive.
- **The 1.0.12 app keeps working.** Its API contracts are unchanged, and the new response fields are additive.
- **Installed 1.0.12 apps stay shared.** They can still move each other, and they set the D2 default that a
  new device starts from. Devices running the new web or 1.1.0 ignore later default changes once they have
  a context.

## 8. Acceptance

The audit's "Acceptance coverage required" list, items 1–10, is the test plan. In short:
- **Isolation:** two browsers, or two guardians, on one child and different teams. A switch in one leaves the
  other's context unchanged.
- **Every path:** daughter and son, self and managed, parent-only accounts, and no teams. Also removed links,
  memberships and teams, and archived teams, under D3 and D4.
- **Seeding:** the first load seeds once. Later default changes from legacy clients don't move migrated
  devices.
- **No forgery or leaks:** a forged or foreign tuple can't act as a teammate, and stale mobile loads after an
  account switch publish nothing (D6).
- **Cookies:** coherent across the main domain, `www`, club subdomains, staging and localhost. Deep links
  keep their destination.
- **Landing:** creation and every invitation mode land as D5 says.
- **Mobile:** tested with the real `AppProvider`, including storage failures and concurrent switches.
- **E2E setup** that selects a team by writing `active_team_id`, such as `team-deletion.spec.ts`, moves to
  browser context.

## 9. Delivery

Two PRs, in order:
1. **Web:** the resolver, cookie, switches, creation, invitations and API fields. It deploys first.
2. **Mobile:** the new context, then a 1.1.0 TestFlight build. It's checked alongside the schedule filter
   before the `ios-v1.1.0` tag moves.
