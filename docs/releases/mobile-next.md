# Mobile release notes — next build

**Status:** unreleased. Everything below is merged to `main`, but **only reaches phones when a new build ships**.
**Current shipped version:** 1.1.0 (tag `ios-v1.1.0`, `2cc88665e`). Its notes are in
[mobile-1.1.0.md](./mobile-1.1.0.md).
**Next version:** 1.1.1, set in `apps/mobile/app.json`. Checkpoint builds for testing run from the Actions tab
("iOS TestFlight", Run workflow), which builds `main` at this version. The release is the `ios-v1.1.1` tag.

The point of this file is that "waiting on a build" is easy to forget. Each entry says what the **installed**
build does, so the cost of waiting stays visible.

---

## Schema changes must tolerate the installed builds

Phones keep running what they have until they update, so 1.1.0 and any remaining 1.0.12 installs both count.
Nothing on the server may need a newer build. [BUG-023](../bugs/fixed/023-device-token-stuck-on-previous-account.md)
is what happens otherwise. Each migration gets a note here saying why those builds are unaffected.

## What is in the build

### Mute one team from the app — [spec §3.4](../specs/team-notification-controls.md)

**Installed build:** the notification settings only have the account-wide switches. A team mute set on the web
still applies on the phone, because the server applies it, but it can't be seen or changed in the app.

**New build:** Settings → Notifications has a Teams section, as on the web. There's one switch per team, grouped
by club, with club teams named "[club] · [team]". Each switch saves as it's flipped, and off stops the team's
email and push, chat included. Reminder controls stay on the web (D14).

Files: `app/(app)/settings/notifications.tsx`, `lib/team-mutes.ts`, `contexts/AppContext.tsx`,
`__tests__/TeamMutesScreen.test.tsx`, `__tests__/team-mutes.test.ts`.

No migration. `team_notification_mutes` shipped with PR #141, and 1.0.12 and 1.1.0 never read it.

## Before shipping

1. `cd apps/mobile && npx jest`, and `npx tsc --noEmit`. CI runs both on every PR, and the TestFlight workflow
   runs them again before it builds.
2. `version` in `apps/mobile/app.json` is the version being released, and the tag matches it.
3. Run the on-device checks below on the TestFlight build, and record each result on its ticket or here.

## On the TestFlight build, before submitting for review

- **Team mutes:** on an account with a club team and a free team, open Settings → Notifications.
  - The club team is under its club's name as "[club] · [team]", and the free team is under "Other teams".
  - Turn a team off and back out of the screen without tapping Save, then reopen it: it's still off, and the web
    shows it off too.
  - Send that team's chat message from another account: no push arrives. Another team's message still does.
  - As a guardian, a team you're on only through a managed player is listed, and your mute doesn't affect the
    other guardian.
  - With the phone offline, flip a switch: it goes back and says it couldn't save.

## After release

Move any ticket waiting on this build to `fixed/`, record the device checks, rename this file for its version,
and start a fresh `mobile-next.md`.
