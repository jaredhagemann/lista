# BUG-017 — Three tests fail in the root selection

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-09-04 by readiness review (verification results)
**Area:** tests / billing / tenant
**Evidence class:** Reproduced — but the original log was **not saved**
**Last verified:** `fa04fc86b`, local run, 2026-09-22 — reproduced identically (218 passed, 3 failed) before repair

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

---

## Fix as implemented

The three failures reproduced identically on 2026-09-22, eighteen days after they were filed: the same
218 passed, 3 failed, 18 files. All three were fixtures, and **in every case the production code was
right**. Verified one at a time rather than assumed.

1. **Tenant resolution.** The setup wrote the retired `plan: "club"`, which the `organizations` plan CHECK
   (`free`, `club_small`, `club_large`) rejects. Nothing was written, so the org never had a subdomain and
   `resolveTenant` correctly returned null — two assertions away from the real cause. The fixture now
   writes `club_large`, sets `subdomain_status: "active"` (the column has no default, and the lookup
   requires it), and **checks the setup write's error**, so an invalid fixture fails where it happens.

2. **Club-settings cache invalidation.** The mocked `organizations:select` returned only `{ subdomain }`.
   The route reads `subdomain, subdomain_status, plan` and requires a club tier to claim a subdomain, so
   the request was rejected by the plan gate long before any cache was invalidated — the test was
   exercising the gate, not the invalidation. The mock now carries a plan.

3. **Billing status authorization.** The route requires an `organization_members` role of owner or
   director; the fixture stopped at the coach membership `createTestTeam` creates. **The 403 was the route
   behaving correctly** — it returns the club's plan, trial dates and Stripe customer and subscription
   ids, which no ordinary team member should see. The fixture now grants an owner role, and the test is
   named for the contract it checks. Production authorization was not touched.

### Two things found while repairing it

**A test that passed for the wrong reason.** `returns 403 when user has been removed from the team but
active_team_id is stale` passed only because its user had no organization role either — the team removal
decided nothing. The route no longer consults team membership at all: `active_team_id` says *which*
organization is being asked about, and the role decides the answer. Probed directly to confirm it: an
owner removed from the team still gets 200, which is right, since leaving a team does not stop someone
owning the club. That case is now split in two — a team member with no org role is refused, and an owner
off the team is still answered — so the 403 has to earn its result.

**Nothing in CI ran these tests.** The unit job runs `tests/unit` and `tests/rrule.test.ts`; the
integration job runs `tests/rls`. `tests/tenant` and `tests/billing` were run by no job, which is how
three failures covering subdomain resolution and billing authorization survived eighteen days. Repairing
the fixtures without closing that gap would have guaranteed a repeat, so the RLS workflow now runs them
too. This is the part of the fix that keeps.

## Verification

- The reported selection is green: **222 passed, 18 files, exit 0**. Log saved at
  [`docs/reviews/2026-09-22-bug017-root-selection.txt`](../../reviews/2026-09-22-bug017-root-selection.txt),
  as the ticket asked, so future failures in it are meaningful.
- 222 rather than 221 because of the owner-off-the-team case added above.
- `apps/web` and the RLS suite were run unchanged to confirm nothing else moved.
- No production code was modified: the diff is three fixtures, one renamed and one added test, and a CI
  step.
