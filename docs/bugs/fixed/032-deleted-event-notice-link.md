# BUG-032 — A deleted event's notice links to its gone page

**Severity:** P3
**Status:** Fixed
**Reported:** 2026-10-06 by the tournament notices work (PR #118), confirmed by the user
**Area:** notifications
**Evidence class:** Mixed: static, then reproduced by the regression test against the unfixed worker
**Last verified:** `fix/032-deleted-event-notice-link`, Vitest with the database mocked

## Symptom

Families get "Cancelled: Practice" when a coach deletes an upcoming event. The email's **View event** button
and the push notification open the event's page, which no longer exists, so they land on a not-found page.

## Reproduction

1. As a coach, delete an upcoming, not-cancelled event.
2. Open the notice's email button, or tap its push.

**Expected:** the schedule, where the event used to be.
**Actual:** `/dashboard/schedule/<deleted id>`, a not-found page.

## Evidence

- `apps/web/src/lib/notifications/worker.ts:105` (on `main` before the fix) set the push URL from
  `job.event_id`, whatever the action.
- `apps/web/src/lib/notifications/worker.ts:268`, `eventUrlOf`, did the same for the email button.
- `notification_jobs.event_id` has no foreign key on purpose ("the event may be gone"), so a deleted event's
  job keeps its id. The "falls back to the schedule" branch only ran for jobs without an id.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Where should a deleted event's notice link? | The schedule, as a deleted tournament's does | The schedule | 2026-10-06 | [Spec §4, Notifications](../../specs/tournaments-and-leagues.md); the user, on PR #118 |

## Cause

Diagnosed. The worker built every single-event link from `job.event_id`, and a deleted event's job still
has one. Nothing checked the action.

---

## Fix as implemented

**Branch:** `fix/032-deleted-event-notice-link`
**PR:** #119
**Migration:** none

- `eventPathOf` in the worker links to the event's page only while it exists, so a `deleted` job goes to
  `/dashboard/schedule`. The email's button, its answer links and the push all use it.
- A deleted job never asks for answers already (`asksForAnswers`), so no answer link pointed at the gone page.
- The email's button reads **View schedule** for a deleted event (`EventEmail`'s new `linkLabel`), and
  **View event** otherwise.
- A cancelled event still exists, and still links to its page.

## Verification

**Test:** `apps/web/tests/deleted-event-notice-link.test.ts` runs the real worker with the database mocked:
- a deleted event's email links to the schedule, not the event, and says "View schedule"
- its push links to the schedule
- a cancelled event's email and push still link to its page, and the button says "View event"

The two deleted-event tests fail against the unfixed worker. The cancelled test guards the legitimate path.

**Deployment verification required:** after deploy, delete an upcoming event on a test team, and check that
the email's button and the push both open the schedule.
