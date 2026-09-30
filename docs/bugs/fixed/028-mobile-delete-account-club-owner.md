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
**PR:** #99
**Migration:** none

- **`apps/mobile/lib/account-deletion.ts`:** `deletionRefusal` turns the server's 409 into a message and a
  way forward, one case per reason:
  - `owns_club`: names the clubs, with a link to Club Settings on the web
  - `owns_teams`: names the teams, offering Team Settings
  - `sole_guardian`: names the players, offering Managed Players
  - anything else: a general message and no button
- **The Settings screen** (`app/(app)/settings/index.tsx`) shows it. A web link opens in the browser; an
  in-app one navigates.

**Review fix: the club link names the club.** `/dashboard/club/settings` picks the club from the browser's
active team. When that team was in another club, the link opened that club instead. When it wasn't in a club,
the link went to the dashboard.
- **`/api/account/delete`** adds `ownedClubs: [{ id, name }]` to the `owns_club` refusal. `clubs` stays
  names only, for the installed app.
- **`/dashboard/club/open?org=<id>`** (new route, like `/dashboard/switch-team`):
  - `findClubTeam` (`src/lib/club/open.ts`) runs as the viewer and checks they are an owner or director of
    the club. It finds an unarchived team of the club they're on; the club adds its directors to every team.
  - The route switches to that team through `setActiveTeam`, then opens club settings.
  - Anything else goes to the dashboard. The dashboard layout moves the page to the club's subdomain
    (BUG-027).
- **The app** links each club to its own route, one button per club. It shows no link when the server sends
  no id.
- **The web's own deletion card** (`account-settings.tsx`) had the same plain link. It now uses the route too,
  with one button per club.

**Reaches phones with the next mobile build:** see `docs/releases/mobile-next.md`. The server and web parts
ship when this merges.

## Verification

**Test:** `apps/mobile/__tests__/account-deletion.test.ts`. The module didn't exist before, and the screen's
old fallback gave the team message for every reason but `sole_guardian`.

**Review fix tests.** Each failed against the plain link:
- `apps/web/tests/club-open-route.test.ts`: the route switches a director of the club, and refuses anyone else,
  a bad id, or a director on none of its teams.
- `tests/rls/club-open.test.ts`: `findClubTeam` against real RLS. An owner of two clubs gets each club's own
  team, archived teams are skipped, and a player on the team gets nothing.
- `apps/web/tests/account-delete-route.test.ts`: the refusal carries `ownedClubs`.
- `apps/web/tests/account-deletion-club-owner.test.tsx`: the web card links `/dashboard/club/open?org=…`, with
  one button per club.
- The app tests: each club gets its own escaped link, and there's no link without an id.

**After the next mobile build ships:** as a club owner whose browser last had another team open, tap Delete
Account in the app. The message names the club, and the button opens that club's settings in the browser.
