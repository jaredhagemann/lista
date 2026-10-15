# BUG-034 — Editing a series with no upcoming events crashes the page

**Severity:** P2
**Status:** Open
**Reported:** 2026-10-15 by the product owner, using the web app
**Area:** events, web
**Evidence class:** Mixed — see below
**Last verified:** `127eb84bd` (main), by code inspection

## Symptom

On an event in a recurring series whose occurrences are all in the past, choosing to edit the entire series
(or this and following events) shows a client-side error instead of the edit form.

## Reproduction

1. On the web, open an occurrence of a recurring series whose occurrences have all started.
2. Click **Edit** and choose **Entire series** (or **This and following**).

**Expected:** the page stays usable. It explains that nothing upcoming can be changed, and still offers to edit
only this event.
**Actual:** a client-side exception.

**Evidence class.**
- **Reproduced:** the symptom, by the product owner in the web UI. The ticket doesn't say which environment.
- **Static:** the cause, by code inspection.

## Evidence

- `apps/web/src/lib/events/series-edit.ts:222-225`: `resolveSeriesEdit` throws
  `SeriesEditError("There are no upcoming events in this series to change.")` when the scope has no upcoming
  anchor.
- `apps/web/src/components/calendar/series-edit-form.tsx:117-119`: the form calls `resolveSeriesEdit` in a
  `useMemo` during render. The throw escapes rendering, so Next.js shows its client error page. The `try`
  around the planner at `series-edit-form.tsx:242-250` only covers the save, not the first render.
- `apps/web/src/components/calendar/event-detail.tsx:858-870`: `handleChooseScope` loads the series and opens
  the form without checking that the scope has an upcoming occurrence.
- The same throw is reachable with **This and following** on a past occurrence that has no upcoming
  occurrence after it. A past occurrence in a series that still has upcoming ones is fine: the anchor moves to
  the next upcoming occurrence.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| What should a bulk edit do when no occurrence is upcoming? | Refuse it at the scope choice, with the planner's message ("There are no upcoming events in this series to change."). Don't open the form, and leave "This event" available. Past events are never rewritten by a bulk edit (the series-edit rules) | As recommended | 2026-10-15 | Product owner; `series-edit.ts` header |

## Cause

`resolveSeriesEdit` throws for a scope with no upcoming occurrence, and the series edit form calls it during
render with no guard. Neither the scope chooser nor the form checks for this case beforehand.

## Proposed fix

- In `handleChooseScope`, after loading the series, run `resolveSeriesEdit` for the chosen scope. On a
  `SeriesEditError`, show its message as a toast and stay on the event, without opening the form.
- As a backstop, the form shouldn't throw from render. Handle the error case in its `useMemo`, so a series that
  stops having upcoming occurrences while the form is open can't crash the page either.

## Regression test

In `apps/web/tests/`, with a series whose occurrences are all past:
- choose **Entire series**: there's no crash, the "no upcoming events" message shows, and the form doesn't open
- choose **This and following**: the same
- the legitimate path: with one upcoming occurrence, **Entire series** opens the form anchored on it
- **This event** still opens the single-event form for a past occurrence

The first two tests fail against the current code, which throws during render.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/034-series-edit-no-upcoming`
**PR:** #NN
**Migration:** none

## Verification

**Test:** `apps/web/tests/…`
