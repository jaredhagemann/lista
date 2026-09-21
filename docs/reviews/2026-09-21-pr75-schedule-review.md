# PR #75 — schedule integration quick review

**Recommendation: request changes.** Reviewed `6815f3febcae572f2d2595406f1daeede2dc3c8a` of [PR #75](https://github.com/jaredhagemann/lista/pull/75).

The preload is removed, event reads use the stage-1 repositories, and the calendar has bounded month reads and LRU capacity. All 41 targeted PR tests passed. Four additional component/cache probes reproduced the following gaps. Application code was not changed.

## 1. P2 — Ignore obsolete list requests before committing rows and cursors

[ScheduleList result handling](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/schedule-list.tsx:156) has no request-generation or cleanup guard. Start one request, select Game while it is pending, let the Game request finish, then resolve the first request: the old rows replace the newer selection. The old `hasNext` and `nextCursor` replace the newer ones too, so the next click can continue the wrong filtered result.

Add a request/context generation check on success, failure, and loading completion. Abort when possible, but also ignore obsolete completions. Cover rapid filter changes and mutation-triggered reloads, not just calendar month races.

## 2. P2 — Reset list cursor history on a team/context change

[Cursor selection](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/schedule-list.tsx:141) keeps the old page/history when `teamId` changes; ScheduleView does not key or otherwise reset the list by team. Reproduced: advance team A to page 2, rerender with team B, and the first B query contains A's cursor while the UI remains on page 2. B's earlier events are skipped, potentially yielding an empty schedule.

Reset rows, current page, cursor history, and next cursor when query identity changes, including the active identity context where applicable. Coordinate this with finding 1 so late A results cannot repopulate B's state. Keying/remounting by the required context is another implementation option.

## 3. P2 — Render the list's failure state instead of the ordinary empty state

[The query catch](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/schedule-list.tsx:167) sets `loadError`, but that flag only hides the pagination footer. The table still takes its empty-result branch. A rejected query reproduced “No upcoming events” with no Retry button; only a temporary toast indicates failure.

Render a persistent load-error row/panel before the empty-result branch, retain filters/navigation as appropriate, and offer Retry for the same query. Reserve empty-schedule copy for successful empty reads.

## 4. P2 — Add a freshness policy to the month cache

[Cache hits](C:/Users/jared/Projects/lista/apps/web/src/lib/events/month-cache.ts:61) always return memory without checking age, and the calendar's cache-hit path exits without revalidation. There is no focus refresh or manual refresh on a successfully loaded month. Advancing the test clock by a day and loading the same month returned the original rows without another read.

While the calendar remains mounted, an edit/cancellation by another user can remain invisible through repeated month navigation. LRU limits memory, not staleness. Add fetched-at/freshness handling and the specified revisit/focus/manual refresh paths. This is independent of the broader mutation-invalidation wiring scheduled for phase 4.

## Verification and scope

- Passed: `month-cache`, `month-range`, `schedule-list-pagination`, `schedule-views`, and `team-timezone-notice`: **41 tests**.
- Passed as evidence of current defects: **four focused review probes**, saved in [the reproduction source](C:/Users/jared/Projects/lista/docs/reviews/2026-09-21-pr75-review-probes.tsx). Its header explains how to run a temporary copy; these observations must be inverted into desired-behavior regressions when fixing.
- The viewer-timezone fallback is explicitly recorded as a user-approved amendment in this PR's spec and was not treated as an unauthorized change.
- This was a focused integration review, not a production/browser end-to-end run or the phase-5 scale audit. The broader mutation wiring remains planned for phase 4.
- Stage 1's earlier four repository findings were resolved at `29d7fa211`; that re-review passed 39 integration tests, nine focused unit tests, and both normal and function-level projection TypeScript checks.
