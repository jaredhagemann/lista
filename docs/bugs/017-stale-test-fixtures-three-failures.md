# BUG-017 — Three tests fail against stale plan fixtures

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-04 by readiness review (verification results)
**Area:** tests / billing

## Symptom

A broader root test selection reports **218 passed, 3 failed** across 18 files. The failures are stale
expectations, not production defects — but they leave the suite permanently red, which hides real
regressions.

## Reproduction

1. Run the unit, recurrence, tenant and billing selection from the repo root.

**Expected:** all pass.
**Actual:** 3 fail:
- an obsolete `club` plan expectation,
- a missing club-plan fixture for a subdomain change,
- an outdated team-member billing access expectation.

## Evidence

- Log: `docs/reviews/2026-09-04-web-test-results.txt`

## Cause

Fixtures were not updated when the club tier monetization work replaced the `club` plan. The report
classifies these as maintenance gaps rather than three independently proven production bugs.

**Not yet localized to specific test files** — the report names the failures but not their paths. First step
of the fix is to re-run and capture them.

## Fix

Update the fixtures to the current plan model.

## Regression test

The failing tests are themselves the coverage; this is a fixture repair. Confirm the suite is green from the
root afterward so future failures are meaningful.
