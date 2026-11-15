# BUG-043 — A client can supply its own tenant headers on the main domain

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-11-03 by Claude, found while checking [BUG-042](./042-club-pages-show-lista-favicon.md)
**Area:** middleware / white-label / email
**Evidence class:** Mixed. The page branding is reproduced on the local stack. The email's brand is reproduced in a unit
test, and no email was sent. Production hasn't been checked, so whether Vercel forwards these headers there isn't
established.
**Last verified:** `d686ad915`, local stack

## Symptom

A request to a host with no tenant can carry its own `x-tenant-*` headers, and the app treats them as real. It can choose
the club name, logo and white-label status the response is built with.

## Reproduction

1. Against the local stack, request `/login` with `x-tenant-id: <any>`, `x-tenant-is-white-label: true` and
   `x-tenant-org-name: Simulated Club`.

**Expected:** the headers are ignored, and the page is Lista's.
**Actual:** the page's title is "Simulated Club".

On its own this only changes the response the sender gets. The next section is why it matters.

## Evidence

- `apps/web/src/middleware.ts:34`: copies the request's headers, and only sets `x-tenant-*` when a tenant resolved. It
  never clears them. The line above it sets `x-request-path` always, "so a client can't supply its own", so the risk was
  already recognized for that header.
- `apps/web/src/lib/supabase/tenant.ts`: `getTenantFromHeaders` trusts them.
- **The email (Static):** `apps/web/src/app/api/auth/signup/route.ts:32` builds the confirmation email's brand from these
  headers, and `tenantEmailBrand` takes the name and logo from them. So a signup request naming someone else's address
  could send that person a real email from Lista's sender, with a name and logo the requester chose. The link in it still
  goes to the real host. **Not run:** no email was sent to test this.

No authorization decision reads these headers, from a search of `tenant.organizationId`, `tenant.slug` and `tenant.plan`
outside the tenant code. That's why this is P2 and not P1.

## Fix as implemented

**Branch:** `fix/043-client-tenant-headers`
**Migration:** none.

`apps/web/src/middleware.ts` deletes every `x-tenant-*` request header before setting the resolved tenant's.

Writing the tests found one case this ticket hadn't listed: **on a club's domain too**, the middleware only sets a header
when the club has that value. So a client could fill in whatever the club left blank, such as a logo. The fix covers it.

**Left as it is:** paths the middleware's matcher skips, such as anything ending `.png`, don't get their headers cleared.
`POST /api/auth/signup.png` returned 404 locally, and the signup route is the only place found where the headers reach
someone else. On those paths they could only change the sender's own response.

## Verification

**Tests:** `apps/web/tests/middleware-tenant-headers.test.ts` runs the real middleware and the real
`getTenantFromHeaders`. Four of its six tests failed before the fix, including the one showing a signup email's brand
taking the client's name. The other two are the legitimate paths: other headers are kept, and a club's own values arrive.

**Browser, local stack:** `/login` with client-sent headers had the title "Simulated Club" before the fix. After it, the
title is "Lista" and the icons are Lista's, the same as a request without them.

**Deployment verification, done 2026-11-04 by Claude:** `/login` on `www.lista.team` with `x-tenant-*` headers is titled
"Lista", and `slofc.lista.team/login` is still titled "SLOFC". This checks titles only; no email was sent.
