# BUG-028 — The app tells a club owner they own teams when they try to delete their account

**Severity:** P2
**Status:** Fixed in code; reaches phones with the next mobile build
**Reported:** 2026-09-29 by Claude. Noted as a follow-up while fixing BUG-013 part 2, filed when reviewing
the mobile release.
**Area:** ios, account
**Evidence class:** Static — see below
**Last verified:** `63c0fcb7a`, code inspection

## Symptom

A club owner taps Delete Account in the app. They're told "You are the owner of one or more teams. Transfer or
delete your team(s)…", and offered Team Settings, which can't resolve it. What blocks them is owning the
club, and nothing in the app says so or says what to do.

## Reproduction

1. Own an open club (BUG-013: an open club must keep an owner).
2. In the app: Settings → Delete Account.

**Expected:** told they own the club, and that they need to hand it to a director or close it, with a way to
do that. Club management is on the web only.
**Actual:** the team-owner message, and a Team Settings button.

## Evidence

- **The server:** `/api/account/delete` refuses a club owner with
  `409 { error: "owns_club", clubs: [...] }` (`apps/web/src/app/api/account/delete/route.ts:25-28`). The same
  route also answers `owns_teams` and `sole_guardian`.
- **The app** (`apps/mobile/app/(app)/settings/index.tsx:106-135`) handles `sole_guardian`, and treats every
  other 409 as the team-owner case.

## Cause

The app's deletion check predates BUG-013's `owns_club` refusal, and its fallback assumes any other refusal
is about teams.

## Proposed fix

The refusal is decided by a small function in `lib/`, one case per server reason:
- **`owns_club`:** names the club(s). Its button opens Club Settings on the web, where ownership is handed
  over or the club closed. That's allowed by Apple's guideline 5.1.1(v): a website link to finish deletion.
- **`owns_teams`:** names the teams.
- **`sole_guardian`:** as now.
- **An unknown reason:** a general message, not a guess.

## Regression test

`apps/mobile/__tests__/account-deletion.test.ts`, checking what each refusal says and offers:
- **`owns_club`:** names the club, and links to Club Settings on the web.
- **`owns_teams`:** names the teams, and offers Team Settings.
- **`sole_guardian`:** names the players, and offers Managed Players.
- **An unknown reason:** gets a general message and no misleading button.

---

## Fix as implemented

**Branch:** `fix/028-mobile-delete-account-club-owner`
**PR:** #PR
**Migration:** none

- **`apps/mobile/lib/account-deletion.ts`:** `deletionRefusal` turns the server's 409 into a message and a
  way forward, one case per reason:
  - `owns_club`: names the clubs, with a link to Club Settings on the web
  - `owns_teams`: names the teams, offering Team Settings
  - `sole_guardian`: names the players, offering Managed Players
  - anything else: a general message and no button
- **The Settings screen** (`app/(app)/settings/index.tsx`) shows it. A web link opens in the browser; an
  in-app one navigates.

**Reaches phones with the next mobile build:** see `docs/releases/mobile-next.md`.

## Verification

**Test:** `apps/mobile/__tests__/account-deletion.test.ts`. The module didn't exist before, and the screen's
old fallback gave the team message for every reason but `sole_guardian`.

**After the next mobile build ships:** as a club owner, tap Delete Account in the app. The message names the
club, and the button opens Club Settings in the browser.
