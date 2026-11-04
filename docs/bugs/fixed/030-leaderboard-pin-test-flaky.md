# BUG-030 — The leaderboard's pinned-row test fails intermittently in CI

**Severity:** P3
**Status:** Fixed
**Reported:** 2026-09-30 by Claude, from a CI failure on PR #105 (which doesn't touch the web app)
**Area:** training, tests / CI
**Evidence class:** Reproduced in CI (twice), with the same error reproduced locally by forcing the timing
**Last verified:** `95ca1f786`, GitHub Actions "Web app tests" and local

## Symptom

The **Web app tests** job failed on PR #105, a mobile-only change, in one web test. The next run, with no web
change, passed. A flaky test can now fail any PR, because CI has run the web app's tests on every PR since #101.

Only the test is known to be affected. Nothing points to users seeing a problem with the pinned row.

## Reproduction

1. CI run `36762647521` (PR #105, commit `22f55eb79`, 2026-09-30), job "Web app tests".
2. `tests/leaderboard-pin.test.tsx` › "LeaderboardTab — pinned self row › removes the pinned copy once the
   self row scrolls back into view" fails.
3. Run `36764827534` on the next commit passed the same test.

**Expected:** the test passes on every run.
**Actual:** it failed once in the last 30 runs of the Tests workflow.

**Second failure:** CI run `41872633414` (`main`, `95ca1f786`, 2026-11-04) failed the "pins a copy of the self row…" test
with the same error, in 1034 ms. Re-running the failed job with no code change passed.

## Evidence

Failure output:

```
FAIL tests/leaderboard-pin.test.tsx > LeaderboardTab — pinned self row > removes the pinned copy once the
     self row scrolls back into view
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
× removes the pinned copy once the self row scrolls back into view 1032ms
```

- **The assertion that failed** is the first wait, `apps/web/tests/leaderboard-pin.test.tsx:160`:
  `await waitFor(() => expect(screen.getAllByText("You")).toHaveLength(2))`. The pinned copy never appeared.
  The test ran for 1032 ms, which is `waitFor`'s 1-second default timeout, so it waited the full time.
- **The mocks:**
  - `fireIntersection` (`:113`) calls back every `MockIntersectionObserver` created so far (`:42`).
  - The mock's `disconnect` does nothing.
- **The component** (`apps/web/src/components/training/leaderboard-tab.tsx:185-200`) creates its observer
  in an effect keyed on `[selfKey, loading]`. When the self row's element isn't mounted, the effect sets
  `selfBelowFold` to false.
- **The same pattern elsewhere:** the "pins" test (`:142`) waits the same way, and passed in that run.

## Cause

**The event can fire before the observer exists.** The row reaches the page before the effect that creates its observer
runs. `findByText` usually gives that effect time to run, but nothing guarantees it. An event fired in the gap reaches no
observer and is lost, so the pin never appears.

How far this is established:

- **Reproduced by forcing the timing.** A test that resumes as soon as the row is on the page saw 0 observers when it
  fired, then failed with the CI error: `expected [ Array(1) ] to have a length of 2 but got 1`.
- **Inferred for CI.** CI's own failures weren't logged at this level, so the match rests on the same error and the same
  full `waitFor` timeout. The natural failure didn't happen locally: 0 of 8 runs idle and 0 of 4 under heavy CPU load.
- **The other candidate wasn't seen.** Nothing pointed to a re-render clearing the pin, but it wasn't ruled out separately.

Only the test is known to be affected. The gap comes from the test firing its own mock event.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/030-leaderboard-pin-flake`
**Migration:** none.

Test only, in `apps/web/tests/leaderboard-pin.test.tsx`:

- `fireIntersection` waits until an observer exists before firing.
- The mock's `disconnect` now removes the observer, so only live ones are called.
- "never pins" fires without waiting, because that case never creates an observer.

The "does not pin" test could also have passed with its event lost. It now always delivers the event.

## Verification

**Regression test:** "still pins when the event comes straight after the row reaches the page" forces the timing and
checks there are 0 observers at that point. With the old helper, this timing failed with the CI error.

**Runs with the fix:** the file passed 10 of 10 idle and 4 of 4 under heavy CPU load. Since the natural failure was rare
and never appeared locally, those loops are weak evidence. The forced test is the stronger evidence. If the failure
returns in CI, the cause above was incomplete.

Web suite passes (1,713), and `tsc` is clean.
