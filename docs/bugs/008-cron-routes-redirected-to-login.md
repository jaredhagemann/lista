# BUG-008 — Every scheduled job is redirected to /login and never runs

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 8)
**Area:** infra / routing / notifications
**Evidence class:** Reproduced against `updateSession` directly — **not** a deployed HTTP flow
**Last verified:** `5acde1074`, local unit probe, 2026-09-04

## Symptom

All three Vercel cron jobs — event reminders, trial expiration, subdomain quarantine — are redirected to
`/login` by session middleware before their handler runs. Vercel cron requests do not follow redirects, so
on a deployment matching this code none of these jobs would execute.

## Reproduction

**Reproduced** by **3 cron probes** (`it.each` over the three paths). The Sept 4 probe file contains 5
assertions in total — those 3 plus one recurrence and one email-formatting probe, which belong to
[BUG-010](./010-event-time-and-recurrence-boundaries.md).

1. Build a `NextRequest` for each path in `apps/web/vercel.json` with no session cookie and a `Bearer` header.
2. Call `updateSession(request)`.

**Expected:** the request reaches the handler, which validates `CRON_SECRET`.
**Actual:** **307 redirect to `/login`** for all three paths, before the secret check.

**Important scope limit:** the probes invoke `updateSession` **directly**. They do not exercise a complete
deployed HTTP flow including the Next.js middleware matcher, so they do not prove the deployed request path
behaves identically. **Whether production reminders have in fact been failing is unverified** — see the
question in the PR description.

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

**Deployment verification required:** confirm against the deployed middleware, using **staging/test data**.
Trial-expiration and subdomain-quarantine jobs act destructively on real clubs; do not first exercise them
against production data.
