# BUG-040 — A series edit labels the time zone with today's abbreviation, not the event's

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-11-02 by CI on PR #146, a docs-only PR (Web app tests)
**Area:** events, notifications
**Evidence class:** Reproduced in CI and locally against the code. The wrong label in a real notice is Static:
no notice was sent to check it.
**Last verified:** `fix/040-series-zone-label-uses-today`, local unit tests

## Symptom

Changing a series' time zone shows a "Time zone" row in the editor's review, and in the notice sent to the team.
Its abbreviation is today's. A December series edited in October reads "4:00 PM PST" on the Time row and
"America/Los Angeles (PDT)" on the Time zone row.

CI also went red. `tests/series-edit-summary.test.ts > a new zone shows both, and the time in each` expects a
September event to read PDT and MDT, so it has failed on every run since the Nov 1 clock change, whatever the PR
changes. It would have passed again on the March change, hiding the bug for the summer.

## Reproduction

1. Run `npx vitest run tests/series-edit-summary.test.ts` in `apps/web` on or after Nov 1, 2026.

**Expected:** `America/Los Angeles (PDT)` and `America/Denver (MDT)`, as on the September event's date.
**Actual:** `America/Los Angeles (PST)` and `America/Denver (MST)`.

## Evidence

- `apps/web/src/lib/notifications/event-time.ts:58`: `formatZoneName(timeZone, at = new Date())` defaults to now.
- `apps/web/src/lib/events/series-summary.ts:68` and `apps/web/src/components/calendar/series-edit-form.tsx:356`
  called it without a date.
- CI run 41506166412, PR #146.

## Cause

Diagnosed: both callers relied on the helper's default of today. The Time row beside them formats the event's own
instants, so the two could disagree whenever a clock change falls between today and the event.

## Fix as implemented

**Branch:** `fix/040-series-zone-label-uses-today`
**PR:** see the PR for this branch
**Migration:** none

Both callers now pass a date. The notice's summary uses the opened occurrence for the old zone, and the moved
occurrence for the new one, matching its Time row. The editor's review uses the opened occurrence for both.

`time-zone-select.tsx` still uses today for its "Times are in…" hint on the form. It describes the zone generally
rather than a particular event, so it's left as it is.

## Verification

**Test:** `apps/web/tests/series-zone-label.test.tsx` pins today to July and edits a December series, so it doesn't
depend on when it runs. Both its tests, the notice's summary and the editor's review, failed against the unfixed
code. `tests/series-edit-summary.test.ts` passes again without being changed.

**Not checked:** a real notice email, and the review dialog in a browser.
