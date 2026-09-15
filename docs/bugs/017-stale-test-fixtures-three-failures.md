# BUG-017 — Three tests fail in the root selection

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-04 by readiness review (verification results)
**Area:** tests / billing / tenant
**Evidence class:** Reproduced — but the original log was **not saved**
**Last verified:** `5acde1074`, local run, 2026-09-04

## Symptom

A broader root test selection reports **218 passed, 3 failed** across 18 files. The failures **appear to
be** stale fixtures/expectations rather than production defects — but each needs verifying against the
current contract before that conclusion is acted on. **One concerns authorization, not merely a renamed
plan.**

A permanently red suite hides real regressions, which is why this is worth fixing promptly even if all
three turn out to be fixture problems.

## Reproduction

```text
node node_modules/vitest/vitest.mjs run tests/unit tests/rrule.test.ts tests/tenant tests/billing --config vitest.config.rls.mts
```

**Expected:** all pass.
**Actual:** 3 fail.

## Evidence

**The original root run's output was not saved.** `docs/reviews/2026-09-04-web-test-results.txt` is the
*web* suite log — 679 passing tests — and is **not** evidence for this ticket. Capture a fresh log under
this ticket when repairing it.

## The three failures

1. **Tenant resolution fixture** — `tests/tenant/tenant.test.ts:170` still writes the obsolete
   `plan: "club"`. Check the setup write's **error** and satisfy the current active-subdomain conditions.
   Changing only an assertion would mask invalid setup.

2. **Club-settings cache invalidation fixture** — `tests/billing/club-settings.test.ts:234` supplies
   `subdomain: "oldslug"` without a club plan, so the current plan gate can reject the request before cache
   invalidation is ever reached.

3. **Billing status expectation** — `tests/billing/status.test.ts:65` relies on **team membership** where
   the route now requires organization owner/director
   (`apps/web/src/app/api/billing/status/route.ts:79`). This is the authorization case: correct the
   fixture and the expected contract. **Do not loosen production billing authorization to make it green.**

## Cause

Fixtures were not updated when the club tier monetization work replaced the `club` plan. Failure 3 is
different in kind — it encodes an outdated authorization expectation.

## Proposed fix

Repair each fixture against the current contract, verifying case by case rather than assuming all three are
cosmetic.

## Regression test

The failing tests are themselves the coverage; this is a fixture repair. Confirm the root selection is
green afterward, and save the log, so future failures in it are meaningful.
