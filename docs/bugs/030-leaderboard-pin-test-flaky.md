# BUG-030 — The leaderboard's pinned-row test fails intermittently in CI

**Severity:** P3
**Status:** Open
**Reported:** 2026-09-30 by Claude, from a CI failure on PR #105 (which doesn't touch the web app)
**Area:** training, tests / CI
**Evidence class:** Reproduced (in CI, once) and Static — see below
**Last verified:** `22f55eb79`, GitHub Actions "Web app tests"

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

**Not yet tried:** reproducing locally, for example by running the file in a loop
(`npx vitest run tests/leaderboard-pin.test.tsx` repeated) or under CPU load.

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

**Not diagnosed.** Two candidates, both inferred from the code and neither confirmed:

1. **The event fires before the observer exists.** The test waits for the text "Me Myself", then fires the
   intersection event right away. If the effect that creates the observer hadn't run yet, there's nothing to
   call back, so the event is lost and the pin never appears. That matches the failure.
2. **Something resets the pin after the event.** A re-render that briefly leaves the self row unmounted
   would run the effect's "not mounted" branch and clear it. The board and summary load together
   (`Promise.all`), so a second load isn't obvious. This one is less likely.

## Proposed fix

Settle the cause first, by reproducing locally or by logging in the test. The likely fix is in the test, not
the component:
- Wait until an observer exists before firing, for example
  `await waitFor(() => expect(h.ioInstances.length).toBeGreaterThan(0))`.
- Fire only the newest observer, and have the mock's `disconnect` drop an instance so stale ones aren't called.

Apply the same to the "pins" test at `:142`.

## Regression test

A flaky test can't fail on demand. Two ways to show the fix works:
- Reproduce the race deliberately, by firing the event before the observer is created, and show the fixed
  test's wait handles it.
- Loop the file enough times, locally or in CI, to show it no longer fails.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

## Verification
