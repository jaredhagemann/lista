# BUG-027 — A link to a club team's page lands on the club's dashboard instead

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-09-29 by the user, after #96 shipped: "clicking an availability link in the email
successfully sets the availability for that account, but then routes the user to the dashboard"
**Area:** routing, notifications
**Evidence class:** Mixed. The symptom was reported in production; the cause below is Static (code
inspection); the team's club settings weren't inspected.
**Last verified:** `63c0fcb7a`, code inspection

## Symptom

A member taps an answer link (or "View event") in an email about a club team. The answer is recorded, but
they land on the club's dashboard rather than the event page, and have to find the event themselves.

## Reproduction

1. Be on a team whose club has an active subdomain (`slofc.lista.team`), with subdomain routing on
   (production).
2. Open an email link: `https://lista.team/dashboard/schedule/<event>?answer=available&for=<profile>`.

**Expected:** the event page, showing "[Player] is marked Available".
**Actual:** the answer is recorded, then `https://slofc.lista.team/dashboard`.

## Evidence

- **The layout redirect** (`apps/web/src/app/dashboard/layout.tsx:142-153`): it sends a club-team user who
  isn't on their club's subdomain to `https://<subdomain>.lista.team/dashboard`, and a free-team user on a
  subdomain to `https://lista.team/dashboard`. The requested page and query are dropped.
- **Parallel rendering:** a layout and its page render in parallel. The event page records the email answer
  (email-upgrade §4.7) while the layout redirects, which is why the answer sticks but the user lands on the
  dashboard.
- **Email links:** they're built on the app's main URL (`NEXT_PUBLIC_APP_URL`), not the club's subdomain, so
  every club-team email link takes this redirect.
- **The middleware** (`apps/web/src/middleware.ts`) forwards no request path to the layout. A layout can't
  read the pathname itself, so the redirect had nothing to keep.

## Cause

The subdomain redirects in the dashboard layout replace the requested path with `/dashboard`.

## Proposed fix

- **The middleware:** forwards the request's path and query (`x-request-path`).
- **The layout's two host redirects:** keep that path and query when it's a same-site dashboard path, and
  fall back to `/dashboard` otherwise. The event page on the club's subdomain then records the same answer
  (harmless) and shows the notice.
- **The middleware's own redirect** of an unknown subdomain to lista.team keeps the query as well as the
  path.

## Regression test

- **Layout:** a club-team user on lista.team, requesting an event page with an answer query, is redirected
  to the same path and query on the club's subdomain. A free-team user on a subdomain goes to the same path
  on lista.team. A missing or off-site path falls back to `/dashboard`.
- **Middleware:** forwards the path and query to the app.

---

## Fix as implemented

**Branch:** `fix/027-email-link-club-subdomain`
**PR:** #98
**Migration:** none

- **The middleware** (`apps/web/src/middleware.ts`) forwards the requested path and query as
  `x-request-path`, always setting it itself so a client can't supply one. Its redirect of an unknown
  subdomain to lista.team keeps the query as well as the path.
- **The dashboard layout** (`apps/web/src/app/dashboard/layout.tsx`): both host redirects, to the club's
  subdomain and back to lista.team, go to that path and query when it's a dashboard page on this site, and
  to `/dashboard` otherwise.
- **The answer:** the event page on the club's subdomain records the answer again (same value, harmless) and
  shows the notice.

**Not changed:** email links still point at the main URL, so a club team's link takes one redirect to the
club's subdomain. Building them on the club's own address would save that hop.

## Verification

**Test:** `apps/web/tests/subdomain-redirect-keeps-page.test.tsx`.
- **Fail against the unfixed code:**
  - the redirects keep the page and query, both ways
  - the middleware forwards the path and overwrites a client's own
- **Pass before and after, as guards:** the fall-back cases (no path, off-site, not a dashboard page) and
  "already on the right host".

**After deploy:** on production, tap an answer link in a club team's email. You should land on the event
page on the club's subdomain, with "… is marked …".
