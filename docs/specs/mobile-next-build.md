# Mobile: the next build

**Status:** Decided 2026-09-29 (scope §1, release §4). In progress. See §5 for the PR plan and where each part
stands.
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
| 2 | Club branding (same spec §2–3) | In the top strip and the team picker (the web's header and picker), club teams inherit the club's logo and read "SLOFC - 12U Girls". Logos draw in any uploaded format, SVG included. | **Include** |
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
  - **One deliberate difference:** the web's `displayLabel` matches lowercase letters with `\p{Ll}`. The
    phone's copy upper-cases the first character of each word instead, because a regex Hermes can't parse
    fails when the app starts. It gives the same results on the web's test cases.
  - **Logos:** the web accepts SVG uploads, and React Native's `Image` can't draw them. `RemoteLogo` asks
    Storage for the file's type and draws SVG with `react-native-svg` (#102).
- **Data:** the screens select what they don't yet read:
  - on events: `opponent`, `home_away`, `uniform`, `score_for`, `score_against`, `game_result`
  - on teams: uniform names and colors, and the club (`organizations(name, org_name_public, logo_url, plan,
    brand_color_secondary)`)
  - in the membership query in `contexts/AppContext.tsx`: the same club fields. #102 added all but
    `brand_color_secondary`, which the Record card adds (part 4).

  Games read the event's own team (`events → teams`), not the active one, as the web does, so an event opened
  from another team's notification is named for that team.

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

**Done 2026-09-30 (part 5):** no change requires 1.1.0. The one breakage, the push-token index, is BUG-023,
fixed in this build. Two by-design refusals reach 1.0.12 users as silent or generic failures: answering for
another team's event, and a closed club. The full review is in `docs/releases/mobile-next.md` →
"Compatibility review".

## 4. Release process

**Today:** pushing a tag `ios-vX.Y.Z` on a commit on `main` runs `.github/workflows/ios-testflight.yml`:
1. It sets the version from the tag.
2. It builds with EAS (build numbers increment remotely).
3. It submits to TestFlight.

Release to the App Store is then done by hand in App Store Connect. `app.json`'s `version` (1.0.0) is never
updated, which is why the release notes said 1.0.0.

**Gaps found on 2026-09-29:**
- **CI didn't run the mobile tests, or the web app's.** Fixed in #101: `test.yml` now runs the web app's
  Vitest and the phone's Jest and `tsc`.
- **Nothing stopped a tag on a failing commit.** Fixed in #101: the TestFlight workflow runs the phone's tests
  and `tsc` before it builds.
- **Stale version:** `app.json` and `docs/releases/mobile-next.md` said 1.0.0. Fixed in #104: `app.json` is
  1.1.0 and the release notes name 1.0.12 as shipped.

| # | Question | Decision (2026-09-29) |
| --- | --- | --- |
| D1 | How the phone gets the web's rules | **Copy** the small pure helpers into `apps/mobile/lib`, with the web's own test cases, as `event-time.ts` already is. Moving them into `packages/utils` is a separate, later task. |
| D2 | Version | **1.1.0**: this build adds features, not only fixes. |
| D3 | Tests in CI | **Yes, before the release.** Add the web app's Vitest and the phone's Jest to `test.yml`, and run the phone's tests and `tsc` in the TestFlight workflow before it builds. |
| D4 | Is 1.0.12 live? | **On the App Store.** Real users run it, so §3 is strict: no server change may assume 1.1.0. |

## 5. Plan and progress

One PR per part. Each is test-first, and adds its entry and on-device check to `docs/releases/mobile-next.md`.

| Part | What | PR | Status |
| --- | --- | --- | --- |
| — | Tests in CI (D3) | #101 | Merged |
| — | BUG-028 club owner deletion, BUG-029 director invitation | #99, #100 | Merged |
| 1 | Labels and club branding, this spec, SVG logos | #102 | Merged |
| 2 | Game display: titles on the home, schedule and event screens; the event screen's Game details | #103 | Merged |
| — | Version 1.1.0 in `app.json`, so checkpoint TestFlight builds run from the Actions tab | #104 | Merged; build 18 reached TestFlight 2026-09-30 after an expired Apple agreement was signed |
| 3 | Availability, trimmed: the ✓ ? ✗ picker with tap-again-to-clear, Players vs Coaches & staff, your own row updating, answering for the profile on the event's team | #105 | Merged |
| — | BUG-030 filed (a flaky web test, not fixed); BUG-031, the chat input hidden by the keyboard, found on build 18 and fixed | #106; #107, #108 | Merged |
| 4 | Dashboard cards: Team card, Record card (reads `brand_color_secondary`) | #109 | In review |
| 5 | Release prep: the §3 compatibility review, and the release notes' final pass | — | Next |

Then the release (§4): push the `ios-v1.1.0` tag, run the release notes' on-device checks on the TestFlight
build, and submit in App Store Connect.

**Fixed in part 3:** the event screen listed team members from the **active** team, not the event's own.
Opened from another team's notification, its response list would show the wrong roster.

**Possible follow-up, not in scope:** the web also shows the uniform on schedule rows and the dashboard's
upcoming events. The phone shows it on the event screen only, as decided in §1.
