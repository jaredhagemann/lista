# BUG-018 — Mobile Jest suites cannot start

**Severity:** P2
**Status:** Not reproducible — the suites run on a current install (2026-09-18)
**Reported:** 2026-09-04 by readiness review (verification results)
**Area:** tests / mobile
**Evidence class:** Reproduced in the **September 4 installed checkout only**
**Last verified:** `5acde1074`, local run, 2026-09-04

**Not reproducible on a current install, 2026-09-17.** All four suites run and pass (`npx jest` in
`apps/mobile`: 4 suites, 26 tests). The September finding was scoped to that checkout’s installed
dependencies, and a reinstall since then appears to have cleared it. Candidate for closing — see Verification.

## Symptom

All four mobile Jest suites fail to start; **zero tests execute**. The mobile app has no working test
verification.

## Reproduction

1. Run the Jest suite in `apps/mobile`.

**Expected:** suites run.
**Actual:** four suites fail at startup — installed dependency resolution lacks
`@babel/runtime/helpers/interopRequireDefault`.

**Scope limit:** observed in the September 4 **installed checkout**. Dependencies were not reinstalled
during that review, so this may be an artifact of that install state. It does **not** establish that
distributed mobile builds crash.

## Evidence

- Log: `docs/reviews/2026-09-04-mobile-test-results.txt`

## Cause

Not yet determined. The missing `@babel/runtime` helper is the symptom; **why resolution failed** — a
missing declared dependency, a hoisting problem in the monorepo, or a stale install — is unknown.

## Proposed fix

**Reproduce on a clean install first.** Do not add the dependency before determining why resolution failed;
adding it may paper over a hoisting problem that will resurface.

## Regression test

Jest **did** report failure here — it was not a silent zero-test pass, and the fix is not about making
failure visible in the runner.

The actual gap is **absent mobile CI coverage**: nothing runs this suite automatically, so the breakage
persisted unnoticed between September 4 and now. Wire the mobile suite into CI, and assert that a
startup failure fails the build rather than being reported only to whoever runs it locally.

---

## Closed 2026-09-18 — Not reproducible

`npx jest` in `apps/mobile` runs all suites and they pass. Checked on 2026-09-17 while working on
[BUG-007](./007-push-delivery-cannot-reach-audience.md), which then added a fifth suite:

```
Test Suites: 5 passed, 5 total
Tests:       31 passed, 31 total
```

The original finding was explicitly scoped to the September 4 checkout’s **installed dependencies**
(`@babel/runtime/helpers/interopRequireDefault` missing), not to anything in the repository. A dependency
reinstall between then and now cleared it, and `apps/mobile/__tests__/chat-notify.test.ts` was written and
run against the current install, so the suites are exercised rather than merely present.

**Not established:** why the install was broken in September. If the same failure appears on a fresh
`pnpm install`, reopen this with the install log — that would point at the lockfile rather than a local
state.
