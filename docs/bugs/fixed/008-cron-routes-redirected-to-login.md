# BUG-008 — Every scheduled job is redirected to /login and never runs

**Severity:** P0 (raised from P1 on 2026-09-15 after production confirmation)
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 8)
**Area:** infra / routing / notifications
**Evidence class:** **Reproduced in production** (2026-09-15) and locally
**Last verified:** production `www.lista.team` 2026-09-15 and `lista-umber.vercel.app` 2026-09-16 — see Production confirmation

**Severity note.** Raised to P0 on 2026-09-15 once the production probe confirmed every scheduled job
has been dead since deploy. Nothing is bypassed and nothing is being destroyed, so this sits under the
third P0 clause in `README.md` — a core workflow confirmed non-functional in production — which was
added for this bug.

## Symptom

All three Vercel cron jobs — event reminders, trial expiration, subdomain quarantine — are redirected to
`/login` by session middleware before their handler runs. Vercel cron requests do not follow redirects, so
**Confirmed in production on 2026-09-15:** none of these jobs can be executing.

## Reproduction

**Reproduced** by **3 cron probes** (`it.each` over the three paths). The Sept 4 probe file contains 5
assertions in total — those 3 plus one recurrence and one email-formatting probe, which belong to
[BUG-010](../010-event-time-and-recurrence-boundaries.md).

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

### The apex-to-www redirect does not affect cron — resolved 2026-09-16

The apex domain redirects to `www` before middleware runs (`lista.team/api/cron/reminders` returns 307
to `www.lista.team/api/cron/reminders`). That looked like a second, independent cause of failure.

It is not. Per Vercel, cron invokes the project's **production deployment URL**, which here is
`lista-umber.vercel.app`, not the custom domain. Probed on 2026-09-16 with the same invalid secret:

```
/api/cron/reminders              307 https://lista-umber.vercel.app/login
/api/cron/trial-expiration       307 https://lista-umber.vercel.app/login
/api/cron/subdomain-quarantine   307 https://lista-umber.vercel.app/login
/ (control)                      200
/api/invite/<uuid> (control)     404   <- reaches its handler
```

The `.vercel.app` host is not redirected to the custom domain, and `src/middleware.ts` does not treat it
as a club subdomain. **The session middleware's login redirect is the only thing stopping cron.** The fix
is middleware-only; no Vercel domain change is needed.

**Post-deploy verification should probe `lista-umber.vercel.app`**, the host cron actually calls.

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

---

## Fix as implemented

**Branch:** `fix/008-cron-routing`
**PR:** #54
**Migration:** none

Two changes, which have to ship together:

1. **Middleware exemption.** `/api/cron/` added to `publicRoutes` in `apps/web/src/lib/supabase/middleware.ts`.
   The prefix includes the trailing slash, so a path like `/api/cronjobs` is still protected.

2. **Secret check hardened.** New `apps/web/src/lib/cron-auth.ts` exports `isAuthorizedCronRequest`, used by
   all three cron routes in place of their inline comparisons. An unset or empty `CRON_SECRET` now rejects
   every request. Before, the check interpolated the variable, so the literal header `Bearer undefined`
   passed on any deployment missing it. The login redirect had been hiding that. Removing the redirect
   without this change would have made trial expiration and subdomain quarantine triggerable by anyone
   on such a deployment.

   The helper is its own module rather than part of `@/lib/api-auth`, because both existing cron test files
   mock `@/lib/api-auth` wholesale and would silently lose the check.

Cause, as diagnosed: `publicRoutes` never listed the cron paths, so the cookie-based login redirect applied to
requests Vercel cron makes without a cookie and does not follow. The `.vercel.app` host cron calls is not
otherwise redirected (see the 2026-09-16 probe above).

## Verification

**Tests** — all failed against the unfixed code for the expected reason, and pass after:

| Test | Before fix | After |
| --- | --- | --- |
| `apps/web/tests/middleware.test.ts` — each `vercel.json` cron path passes `updateSession` unauthenticated (×3) | redirected to `/login` | pass |
| `apps/web/tests/reminders-cron.test.ts` — `Bearer undefined` with `CRON_SECRET` unset | **500** (got past auth) | 401 |
| `apps/web/tests/trial-expiration-cron.test.ts` — same | **200** (job ran) | 401 |
| `apps/web/tests/subdomain-quarantine-cron.test.ts` — same | **200** (job ran) | 401 |

Guards that passed before and must keep passing: an unrelated protected API route still redirects;
`/api/cronjobs` is not exempted; cron paths are still inside the middleware matcher. `reminders-cron.test.ts`
is new — that route previously had no tests.

Full `apps/web` suite: 694 passed. `tsc --noEmit`: clean. ESLint on changed files: clean.

**Coverage gap, not fixed here:** CI (`.github/workflows/test.yml`) runs only the root unit tests and the RLS
suite, not `apps/web/tests`. These regression tests protect against a regression only when run locally.

**Before merge — done 2026-09-16:** both checks below passed. `CRON_SECRET` is set in all Vercel environments, and the trial-expiration backlog query returned **no rows** in production, so the first run has nothing to process.

1. **`CRON_SECRET` is set in Vercel's Production environment.** Vercel attaches `Authorization: Bearer <CRON_SECRET>`
   to cron requests only when the variable exists. If it is missing, every job now returns 401. That's safe,
   but the jobs still won't run.
2. **Inventory the trial-expiration backlog.** The expiration query has no lower bound
   (`trial_ends_at < now()`), and the job has never run, so the first run processes every lapsed trial at once.
   Orgs with a default payment method get a Stripe subscription and are charged; the rest are downgraded to
   free, with subdomain quarantined and team limit set to 1. Read-only check in the production SQL editor:

   ```sql
   select id, name, plan, trial_ends_at, stripe_customer_id
   from organizations
   where subscription_status = 'trialing'
     and trial_ends_at < now()
     and stripe_subscription_id is null
   order by trial_ends_at;
   ```

   Reminders (24-hour window) and subdomain quarantine (180 days; subdomains shipped 2026-06-17) have no
   backlog.

**After deploy — required:** re-run the invalid-secret probe against `lista-umber.vercel.app`, the host cron
calls. Each cron path must return **401** instead of 307. Then confirm each job's next scheduled run in the
Vercel Cron Jobs view or logs: 02:00 UTC quarantine, 12:00 UTC reminders and trial expiration.

**Deployed verification — done 2026-09-16** (merge `eceaceac9`, PR #54). Invalid-secret probe against
`lista-umber.vercel.app`:

```
/api/cron/reminders             wrong secret       401   (was 307 -> /login)
/api/cron/trial-expiration      wrong secret       401   (was 307 -> /login)
/api/cron/subdomain-quarantine  wrong secret       401   (was 307 -> /login)
/api/cron/reminders             Bearer undefined   401
/dashboard                      control            307 -> /login
```

Still to confirm: the first scheduled runs succeed — 02:00 UTC quarantine and 12:00 UTC reminders and trial
expiration on 2026-09-17.

**First scheduled runs — 2026-09-17.** The 12:00 UTC reminders job **ran in production**: the user received a
real reminder email for a same-day practice. That email exposed the timezone defect in
[BUG-010](../010-event-time-and-recurrence-boundaries.md), which is a separate bug. The 02:00 UTC
subdomain-quarantine and 12:00 UTC trial-expiration runs have no user-visible output and are not yet confirmed.
Check them in the Vercel Cron Jobs view.
