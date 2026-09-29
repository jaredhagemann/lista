# Mobile: the next build

**Status:** Scope decided 2026-09-29. Release process decisions in §4 are open.
**App:** `apps/mobile` (Expo / React Native, iOS). **Last shipped:** `ios-v1.0.12`, 2026-04-14 (commit
`b3473c71b`).
**Already in the build** (merged, waiting on it): the fixes in `docs/releases/mobile-next.md`:
- BUG-007, gaps 1 and 4
- BUG-010, BUG-011 and BUG-023
- BUG-028 (#99) and BUG-029 (#100)

The web has moved on since April. This build brings the phone in line with it where it matters day to day.

## 1. Scope (decided 2026-09-29)

| # | Web improvement | On the phone | Decision |
| --- | --- | --- | --- |
| 1 | Consistent labels (`docs/specs/team-branding-and-labels.md` §1) | Roles, relationships and event types capitalized as words ("Coach", "Mom", "Game"). Some screens capitalize with styles, others print raw values. | **Include** |
| 2 | Club branding (same spec §2–3) | Club teams inherit the club's logo, and the team switcher reads "SLOFC - 12U Girls". | **Include** |
| 3 | Game display (`docs/specs/game-display-and-uniform-colors.md`) | "12U Girls @ Rivals FC" titles on the home, schedule and event screens; home/away and the uniform with its color on the event screen; the score once a result is entered. | **Include** |
| 4 | Availability on the event page | Trimmed: the ✓ ? ✗ picker (tap again to clear), the response list split into Players and Coaches & staff, and your own row updating when you answer. Coaches answering for players comes later. | **Include, trimmed** |
| 5 | Dashboard cards (`team-branding-and-labels.md` §4) | On the home screen: the Team card (logo or initials, name, club · season, members by name and role) and the Record card (W–L–T with the bar, last game as a scoreline), shown once a game has a result. | **Include** |

**Not brought over:**
- **Answering from an email:** email links open the web by design.
- **Loading feedback:** a web-specific problem.
- **Coaches answering for players:** later.

## 2. Design notes

- **Same rules as the web.** Labels, branding, game titles, uniforms and the record follow the web's rules
  exactly: capitalization, club plans only, `org_name_public` else the club's name, the team's own logo first,
  "@" away and "vs" home, the record over games with a result. See §4, D1 for how the code is shared.
- **Data:** the screens select what they don't yet read:
  - on events: `opponent`, `home_away`, `uniform`, `score_for`, `score_against`, `game_result`
  - on teams: uniform names and colors, and the club (`organizations(name, org_name_public, logo_url, plan,
    brand_color_secondary)`)
  - in the membership query in `contexts/AppContext.tsx`: the same club fields

  All of these are existing columns. Nothing on the server changes for this build.
- **Record bar colors:** as on the web. Wins in the club's secondary color (else lista blue `#01D7F4`),
  losses black, ties grey.
- **Tests:** each shared rule has Jest tests on the phone (the web's own cases, reused). Each screen change
  has a screen test where the phone already has the pattern (`HomeScreen.test.tsx`). A source scan fails if a
  role, relationship or event type is printed raw, as on the web (`apps/web/tests/labels.test.tsx`).

## 3. Compatibility with the installed build

Phones on 1.0.12 keep working until they update, so nothing server-side may assume the new build. The release
checklist in `docs/releases/mobile-next.md` asks for this review. Since April it has to cover every migration
after `b3473c71b`, checking each against what 1.0.12 reads and writes:
- BUG-013 (clubs, owners, closure)
- uniform colors
- event time zones
- the push subscription index (BUG-023 already bit once)
- the notification triggers
- the series-edit notice

This build adds no server change.

## 4. Release process

**Today:** pushing a tag `ios-vX.Y.Z` on a commit on `main` runs `.github/workflows/ios-testflight.yml`:
1. It sets the version from the tag.
2. It builds with EAS (build numbers increment remotely).
3. It submits to TestFlight.

Release to the App Store is then done by hand in App Store Connect. `app.json`'s `version` (1.0.0) is never
updated, which is why the release notes said 1.0.0.

**Gaps:**
- **CI doesn't run the mobile tests, or the web app's.** `test.yml` runs only the root unit tests and the
  database suites. The web's 1,268 tests and the phone's Jest suite run only locally.
- **Nothing stops a tag on a failing commit:** the TestFlight workflow runs no tests of its own.
- **Stale version:** `docs/releases/mobile-next.md` names 1.0.0 as current.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | How the phone gets the web's rules | (a) Copy the small pure helpers into `apps/mobile/lib`, with the web's tests, as `event-time.ts` already is. (b) Move them into `packages/utils`, empty so far, and share them. That needs Metro and Next workspace configuration, and an EAS build to prove it. | (a) now; (b) as its own task later |
| D2 | Version | `1.1.0` (new features) or `1.0.13` | `1.1.0` |
| D3 | Tests in CI | Add the web app's Vitest and the phone's Jest to `test.yml`, and run the phone's tests in the TestFlight workflow before building | Yes, in a PR before the release |
| D4 | Is 1.0.12 live on the App Store, or TestFlight only? | Decides how many people are on the old build, and how strict §3 must be | (Your answer) |
