# BUG-026 — An event link for a team other than the active one sends you to the dashboard

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-09-28 by Claude, while designing email part 2 (`docs/specs/email-upgrade.md` §4.7)
**Area:** events
**Evidence class:** Static — see below
**Last verified:** `2f905610f`, code inspection

## Symptom

Someone on two teams, such as a coach of two teams or a guardian with children on different teams, taps
"View event" in an email about their *other* team. Instead of the event, they land on the dashboard of
whichever team happens to be active, and have to switch teams and find the event themselves.

## Reproduction

1. Be a member of teams A and B, with A active.
2. Open `/dashboard/schedule/<an event of team B>`, e.g. from a reminder email.

**Expected:** team B's event page, with B now the active team.
**Actual:** a redirect to `/dashboard`, still showing team A.

## Evidence

`apps/web/src/app/dashboard/schedule/[eventId]/page.tsx:47-50`:
- The page redirects to `/dashboard` whenever the active membership's team isn't the event's team.
- It doesn't consider that the viewer, or a player they manage, may also be on the event's team.
- RLS has already let them read the event by then.

## Cause

The page treats "not the active team" as "no access". Switching teams is a separate step (`setActiveTeam`,
from the team picker) that the link never takes.

## Proposed fix

- **The page:** when the event's team isn't the active one, redirect to a small route,
  `/dashboard/switch-team?team=<event's team>&next=<this page and its query>`.
- **The route:** calls the team picker's own `setActiveTeam`. That checks the viewer (or a managed player) is
  on the team, and sets the active team and the "viewing as" cookie. Then it redirects back to `next`,
  marked `switched=1`. A page can't set cookies, so the switch needs a route.
- **Anyone not on the team:** is sent to `/dashboard`, as today.
- **Loop guard:** if the page still doesn't match after a switch (`switched=1`), it goes to `/dashboard`.
- **`next`:** passes through `sanitizeNext`.

## Regression test

- **Page:** an event of a non-active team redirects to the switch route, with the page (and its query) as
  `next`. After a switch that didn't take, it goes to the dashboard.
- **Route:**
  - it switches through `setActiveTeam` and returns to `next`
  - a team the viewer isn't on goes to `/dashboard`
  - an off-site `next` goes to `/dashboard`

---

## Fix as implemented

**Branch:** `fix/026-event-link-other-team`
**PR:** #94
**Migration:** none

- **The event page** (`apps/web/src/app/dashboard/schedule/[eventId]/page.tsx`): when the event's team isn't
  the active one, it redirects to `/dashboard/switch-team?team=<event's team>&next=<this page and its query>`.
  If a switch has already happened (`switched=1`) and still doesn't match, or the event has no team, it goes to
  `/dashboard` as before.
- **The switch** (`apps/web/src/app/dashboard/switch-team/route.ts`, new): calls the team picker's
  `setActiveTeam`. That checks the viewer or a player they manage is on the team, and sets the active team and
  the "viewing as" cookie. Then it redirects to `sanitizeNext(next)` with `switched=1`; on refusal, to
  `/dashboard`.

**Not handled:** `setActiveTeam`'s `redirectUrl`, the move to a club's own subdomain. The switch keeps the
viewer on the site they arrived on. That's the same app and data, just not the club's address, which the team
picker still offers.

## Verification

**Test:** `apps/web/tests/event-link-other-team.test.tsx`.
- **Fail on the unfixed code:**
  - the page tests: it redirected straight to `/dashboard`
  - the route tests: the route didn't exist
- **Pass on the fixed code:**
  - hand-off with the query kept
  - loop guard
  - switch and return
  - refusal
  - off-site `next`
  - no team

**After deploy:** as a member of two teams, open an event of the non-active team from an email link and
confirm its page opens with that team active.
