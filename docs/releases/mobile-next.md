# Mobile release notes — next build

**Status:** unreleased. Everything below is merged to `main`, but **only reaches phones when a new build ships**.
**Current shipped version:** 1.1.0 (tag `ios-v1.1.0`, `2cc88665e`). Its notes are in
[mobile-1.1.0.md](./mobile-1.1.0.md).
**Next version:** not chosen. `apps/mobile/app.json` still says 1.1.0, so set the version before the next
TestFlight build. The release is the matching `ios-v*` tag.

The point of this file is that "waiting on a build" is easy to forget. Each entry says what the **installed**
build does, so the cost of waiting stays visible.

---

## Schema changes must tolerate the installed builds

Phones keep running what they have until they update, so 1.1.0 and any remaining 1.0.12 installs both count.
Nothing on the server may need a newer build. [BUG-023](../bugs/fixed/023-device-token-stuck-on-previous-account.md)
is what happens otherwise. Each migration gets a note here saying why those builds are unaffected.

## What is in the build

Nothing yet.

## Before shipping

1. `cd apps/mobile && npx jest`, and `npx tsc --noEmit`. CI runs both on every PR, and the TestFlight workflow
   runs them again before it builds.
2. `version` in `apps/mobile/app.json` is the version being released, and the tag matches it.
3. Run the on-device checks below on the TestFlight build, and record each result on its ticket or here.

## On the TestFlight build, before submitting for review

Nothing yet.

## After release

Move any ticket waiting on this build to `fixed/`, record the device checks, rename this file for its version,
and start a fresh `mobile-next.md`.
