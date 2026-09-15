# BUG-008 — Every scheduled job is redirected to /login and never runs

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 8)
**Area:** infra / routing / notifications
**Evidence class:** **Reproduced in production** (2026-09-15) and locally
**Last verified:** production `www.lista.team`, 2026-09-15 — see Production confirmation below

## Symptom

All three Vercel cron jobs — event reminders, trial expiration, subdomain quarantine — are redirected to
`/login` by session middleware before their handler runs. Vercel cron requests do not follow redirects, so
**Confirmed in production on 2026-09-15:** none of these jobs can be executing.

## Reproduction

**Reproduced** by **3 cron probes** (`it.each` over the three paths). The Sept 4 probe file contains 5
assertions in total — those 3 plus one recurrence and one email-formatting probe, which belong to
[BUG-010](./010-event-time-and-recurrence-boundaries.md).

1. Build a `NextRequest` for each path in `apps/web/vercel.json` with no session cookie and a `Bearer` header.
2. Call `updateSession(request)`.

**Expected:** the request reaches the handler, which validates `CRON_SECRET`.
**Actual:** **307 redirect to `/login`** for all three paths, before the secret check.

**Local scope limit:** the Sept 4 probes invoke `updateSession` **directly**, so they did not exercise a complete
deployed HTTP flow. That gap has since been closed by the production probe below.

## Production confirmation — 2026-09-15

Probed with a **deliberately invalid** bearer token, so no job could execute: all three handlers
return 401 before doing any work, and a wrong secret is rejected either way.

```
reminders              307 https://www.lista.team/login
trial-expiration       307 https://www.lista.team/login
subdomain-quarantine   307 https://www.lista.team/login
```

**Control probes**, to rule out "everything redirects":

```
/                                         200
/login                                    200
/api/invite/<uuid>                        404   <- reaches its handler
/api/cron/reminders (no auth header)      307 -> /login
```

The `/api/invite/` 404 is the decisive control: it proves the middleware exemption mechanism works
and that the March fix is still in place. Cron paths specifically are not exempted.

**These jobs have never run in production.** Event reminders, trial expiration and subdomain
quarantine have all been silently dead since deploy.

### A second redirect in front of the first

The apex domain redirects to `www` **before** middleware runs:

```
https://lista.team/api/cron/reminders  ->  307  https://www.lista.team/api/cron/reminders
```

So there are two independent redirects that each kill a cron request, since Vercel cron does not
follow redirects. **Check which domain the cron jobs are actually configured against in the Vercel
dashboard.** Exempting `/api/cron/*` in middleware fixes nothing if cron targets the apex and dies at
canonicalization instead. Both have to be right.

## Evidence

- Middleware allowlist: `apps/web/src/lib/supabase/middleware.ts:62`
- Cron configuration: `apps/web/vercel.json:1`
- Probe code: `docs/reviews/2026-09-04-routing-time-probes.test.ts`
- Probe results: `docs/reviews/2026-09-04-routing-time-results.txt`
- [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

## Cause

`publicRoutes` in the middleware does not exempt the `/api/cron/*` paths, so cookie-based login redirection
applies to them.

This has a precedent: `docs/specs/archive/bug-fixes-and-test-improvements.md` fixed the same class of bug
for `/api/invite/` and `/api/managed-profiles` in March, without adding the cron paths.

## Proposed fix

Route cron requests to their secret-authenticated handlers without an interactive login requirement.

**Watch the secret comparison itself.** Existing comparisons interpolate `CRON_SECRET`; with the variable
unset, a literal `Bearer undefined` must **not** be accepted. Exempting the route from login while leaving
that comparison in place would turn a dead job into an open one.

Verify through the **deployed** middleware path, not only locally.

## Regression test

- a valid secret reaches the handler
- a **missing** `Authorization` header is rejected
- an **invalid** secret is rejected
- **`CRON_SECRET` unset** rejects everything, including a literal `Bearer undefined`
- unrelated routes remain login-protected — the exemption must not widen

Drive the path list off `vercel.json` so a newly added cron job cannot regress silently.

**Deployment verification required:** re-run the production probe above after deploying. A 401 replaces the
307 when it is fixed. Use **staging/test data** for any probe that carries a *valid* secret.
Trial-expiration and subdomain-quarantine jobs act destructively on real clubs; do not first exercise them
against production data.
