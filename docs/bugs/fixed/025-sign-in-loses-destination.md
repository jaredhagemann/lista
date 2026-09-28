# BUG-025 — Signing in from a link lands on the dashboard, not the page the link was for

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-09-28 by Claude, while designing email part 2 (`docs/specs/email-upgrade.md` §4.7)
**Area:** auth
**Evidence class:** Static — see below
**Last verified:** `2f905610f`, code inspection

## Symptom

A signed-out member taps "View event" in a reminder email, signs in, and lands on the dashboard instead of the
event. The same happens for any deep link: a roster profile, a chat, the club portal link in an ownership
offer. They have to find the page again themselves.

## Reproduction

1. Sign out.
2. Open `/dashboard/schedule/<an event id>`.
3. The login page opens. Sign in with email and password.

**Expected:** the event page.
**Actual:** the dashboard.

## Evidence

- **The middleware** (`apps/web/src/lib/supabase/middleware.ts:68-72`) sends a signed-out visitor to `/login`
  by changing the path only. It never records where they were going, and it carries the original query string
  over onto `/login`.
- **Email-and-password sign-in** (`apps/web/src/app/(auth)/login/login-form.tsx`) reads `next` (line 37), but
  after a successful password sign-in navigates to `/dashboard` regardless. Only "Continue with Google" passes
  `next` on (to `/auth/callback`, which runs it through `sanitizeNext`).
- **Already signed in:** a signed-in visitor on `/login` is always sent to `/dashboard`, ignoring `next`
  (`middleware.ts:75-79`).

## Cause

All three points above. There is no `next` to follow, and the password path wouldn't follow one anyway.

## Proposed fix

- **The middleware** redirects to `/login?next=<path and query>` for pages. API routes answer for themselves.
  A signed-in visitor on `/login` goes to `next`, when it's safe, instead of `/dashboard`.
- **The login form** navigates to `next` after a password sign-in.
- Every `next` goes through `sanitizeNext`: a same-site path only, never `//host` or an absolute URL.

## Regression test

- **Middleware:** a signed-out request for an event page with a query redirects to `/login` with exactly that
  path and query as `next`. A signed-in visitor on `/login?next=…` goes there. A `next` of `//evil.example`
  goes to `/dashboard`.
- **Login form:** a password sign-in with `?next=/dashboard/schedule/e1` goes there. With an unsafe `next` it
  goes to `/dashboard`.

---

## Fix as implemented

**Branch:** `fix/025-sign-in-loses-destination`
**PR:** #PR
**Migration:** none

- **The middleware** (`apps/web/src/lib/supabase/middleware.ts`):
  - A signed-out visitor is sent to `/login?next=<path and query>`. `next` is the only parameter; the page's
    own query goes inside it rather than onto `/login`.
  - A signed-in visitor on `/login` goes to `sanitizeNext(next)`, which falls back to `/dashboard`.
- **The login form** (`apps/web/src/app/(auth)/login/login-form.tsx`): a password sign-in navigates to
  `sanitizeNext(next)`, as Google sign-in already did through `/auth/callback`.

`sanitizeNext` accepts same-site paths only, so neither path can be turned into an open redirect.

## Verification

**Tests** (both fail against the unfixed code):
- **`apps/web/tests/middleware.test.ts`, "sign-in returns to the page (BUG-025)":** the signed-out redirect
  carries exactly the page and query as `next`, and a signed-in visitor on `/login?next=` goes there. The
  off-site `next` case passes before and after, guarding the fix.
- **`apps/web/tests/login-form-google.test.tsx`, "password sign-in follows ?next= (BUG-025)":** a password
  sign-in goes to `next`, or to `/dashboard` when `next` leaves the site.

**After deploy:** sign out on production, open an event link from an email, sign in with a password, and
confirm the event page opens.
