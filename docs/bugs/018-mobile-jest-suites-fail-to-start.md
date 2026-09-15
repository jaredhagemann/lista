# BUG-018 — Mobile Jest suites cannot start

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-04 by readiness review (verification results)
**Area:** tests / mobile

## Symptom

All four mobile Jest suites fail to start; **zero tests execute**. The mobile app has no working test
verification.

## Reproduction

1. Run the Jest suite in `apps/mobile`.

**Expected:** suites run.
**Actual:** four suites fail at startup — installed dependency resolution lacks
`@babel/runtime/helpers/interopRequireDefault`.

**Environment:** observed in the Sept 4 checkout. This blocks verification; it does **not** establish that
distributed mobile builds crash.

## Evidence

- Log: `docs/reviews/2026-09-04-mobile-test-results.txt`

## Cause

A missing `@babel/runtime` dependency in the installed mobile tree. Whether this is a missing declared
dependency or an artifact of that checkout's install state is unconfirmed — the report notes dependencies
were not reinstalled during the review.

## Fix

Reproduce on a clean install first. If it persists, add the missing dependency explicitly.

## Regression test

Once suites run, wire the mobile suite into CI so a startup failure fails the build rather than passing
silently with zero tests — this is the gap that let it go unnoticed.
