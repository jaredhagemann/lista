# BUG-039 — The series time zone test fails in CI for an hour before a clock change

**Severity:** P3
**Status:** Fixed
**Reported:** 2026-10-27 by CI on PR #142 (RLS integration tests, runs at 06:0x UTC)
**Area:** tests (events, time zones)
**Evidence class:** Reproduced — CI failed twice on PR #142, and the fixture's date maths was reproduced in
a test pinned to the CI run's start time
**Last verified:** `fix/039-timezone-series-fixture-dst`, local stack

## Symptom

`tests/rls/event-timezone.test.ts > series edits keep and change the series' zone > changing the series'
zone moves upcoming occurrences to the same local time there` fails in CI. It fails again on rerun, then
passes later in the day. The product code isn't involved; any PR that runs CI in that hour goes red.

## Reproduction

1. Run the RLS suite between 06:00 and 07:00 UTC in the days before Denver's autumn clock change (Nov 1,
   2026). The window moves to 05:00–06:00 UTC before the spring change.
2. The `denverSeries` fixture reads its first date two days out. At 06:17 UTC on Oct 27 that is 00:17 in
   Denver on Thu Oct 29.

**Expected:** four Thursday occurrences: Oct 29, Nov 5, 12 and 19.
**Actual:** Oct 29, then Wed Nov 4, 11 and 18. The series' rule says Thursdays, so the planner treats the
three Wednesday events as moved occurrences and adds Thursday ones. The test then finds new rows where it
expects the same ids.

## Evidence

- CI runs 40459963846 (two attempts, PR #142): the failure named above.
- `tests/rls/event-timezone.test.ts` (before the fix): `denverSeries` placed week *n* at
  `first + n × 7 × 24h` and read its Denver date. After Nov 1 Denver is an hour further behind UTC, so that
  instant reads 23:17 on the day before.
- `tests/rls/event-series.test.ts` builds its series with `setDate`, by calendar date, and isn't affected.

## Cause

Diagnosed: the fixture stepped weeks by elapsed time instead of by calendar date, so a clock change between
the first and later occurrences moved the later ones back an hour, past midnight when the first one was
read in the hour after midnight.

## Fix as implemented

**Branch:** `fix/039-timezone-series-fixture-dst`
**PR:** see the PR for this branch
**Migration:** none

The fixture's dates now come from `weeklyDenverDates(from)`, which reads the first Denver date once and
adds 7 calendar days to that date for each week. The occurrence times are still built from those dates at
16:00 Denver time with `instantFromWallClock`, as before.

## Verification

**Test:** `tests/rls/event-timezone.test.ts > the series fixture's dates (BUG-039) > stay on one weekday
when a clock change falls between them` pins `from` to 2026-10-27T06:17Z, the CI run's start. Against the
old arithmetic it returned `2026-11-04`, `-11`, `-18` for weeks 2–4 and failed. It passes with the fix, as
does the rest of the file (13/13) on the local stack.

The two series tests themselves still read the real clock, so the pinned test is what covers the window.
No deployment check is needed: this changes a test only.
