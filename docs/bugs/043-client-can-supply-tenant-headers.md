# BUG-043 — A client can supply its own tenant headers on the main domain

**Severity:** P2
**Status:** Open
**Reported:** 2026-11-03 by Claude, found while checking [BUG-042](./fixed/042-club-pages-show-lista-favicon.md)
**Area:** middleware / white-label / email
**Evidence class:** Mixed. The page branding is reproduced on the local stack. The email is Static. Production hasn't
been checked, so whether Vercel forwards these headers there isn't established.
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

## Proposed fix

In the middleware, delete every `x-tenant-*` request header before setting the resolved ones, as `x-request-path` already
is. A real tenant's headers are unaffected.

## Regression test

- Middleware: a request on the main domain with `x-tenant-*` headers forwards none of them.
- Middleware: a request on a club's domain carrying a different `x-tenant-*` value forwards the resolved club's.
- Legitimate path: a club's own domain still gets all its tenant headers.
