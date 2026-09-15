# BUG-008 — Every scheduled job is redirected to /login and never runs

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 8)
**Area:** infra / routing / notifications

## Symptom

All three Vercel cron jobs — event reminders, trial expiration, subdomain quarantine — are redirected to
`/login` by session middleware before their handler runs. Vercel cron requests do not follow redirects, so
on a deployment matching this code none of these jobs ever executes.

## Reproduction

**Reproduced** against the session middleware (5/5 routing probes confirmed).

1. Issue a request with no session cookie and a `Bearer` header to each path in `apps/web/vercel.json`.

**Expected:** the request reaches the handler, which validates `CRON_SECRET`.
**Actual:** **307 redirect to `/login`** for all three paths, before the secret check.

**Environment:** reproduced locally against the real middleware path; production behavior follows the same
code. Whether production reminders have in fact been silently failing is **unverified** — see "Questions".

## Evidence

- Middleware allowlist: `apps/web/src/lib/supabase/middleware.ts:62`
- Cron configuration: `apps/web/vercel.json:1`
- Probe results: `docs/reviews/2026-09-04-routing-time-results.txt`
- Probe code: `docs/reviews/2026-09-04-routing-time-probes.test.ts`
- [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

## Cause

`publicRoutes` in the middleware does not exempt the `/api/cron/*` paths, so cookie-based login redirection
applies to them.

This has a precedent: `docs/specs/archive/bug-fixes-and-test-improvements.md` fixed the same class of bug
for `/api/invite/` and `/api/managed-profiles` in March, without adding the cron paths.

## Fix

Route cron requests to their secret-authenticated handlers without an interactive login requirement. Verify
invocation, completion and failure alerting through the **deployed** middleware path, not just locally.

## Regression test

Assert a no-cookie `Bearer` request to each configured cron path reaches its handler and is rejected only
by `CRON_SECRET` validation. Drive the assertion off `vercel.json` so a newly added cron job cannot
regress silently.
