# BUG-006 — Schedule changes send no notification to families

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 6)
**Area:** events / notifications
**Evidence class:** Static — traced through the event UI; no live dispatch observed
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Symptom

A coach cancels tonight's practice, sees "Event cancelled," and no parent is notified. The same is true for
event creation, individual edits, restores and deletions. Only the entire-series edit calls the
notification route, and it ignores the result.

## Reproduction

**Static.** No end-user reproduction recorded — the finding is a trace of the event UI. A live repro
(cancel an event on a team with a subscribed parent, observe no email or push) has not been run.

1. As a coach, create an event on a team with at least one parent who has notifications enabled.
2. Cancel it from the event detail sheet.

**Expected:** a cancellation notification reaches the team's families — per the D3 matrix below, a
cancellation is one of the cases the coach **cannot** suppress.
**Actual:** no notification is dispatched from this path.

## Evidence

- Event creation: `apps/web/src/components/calendar/event-form-dialog.tsx:228`
- Single edit: `apps/web/src/components/calendar/event-detail.tsx:381`
- Cancel / restore / delete: `apps/web/src/components/calendar/event-detail.tsx:785`

## Product decisions

Settled as **D3** in `docs/reviews/2026-09-15-bug-backlog-review.md`, 2026-09-15. This replaces the earlier
"every mutation notifies" assumption, which would have alerted families on typo corrections and historical
edits.

| Action | Notification behavior |
| --- | --- |
| Create an upcoming event | Notify by default; coach may switch off during creation |
| Create/import a series or bulk schedule | **One summary per team** for the operation, not one alert per occurrence; coach may switch off |
| Change date, start/end/arrival time, or location of an upcoming or in-progress event | Notify automatically; **coach cannot suppress** |
| Cancel, restore, or delete an upcoming or in-progress event | Notify automatically; **coach cannot suppress**. Deleting an already-canceled event sends no second notice |
| Change only title/description/notes | Optional, **off by default** |
| Edit a historical event, or save with no actual change | **No notification** |

Recipient opt-outs under D2 still apply to the non-suppressible cases — "coach cannot suppress" binds the
sender, not the recipient.

Batch multiple occurrences from one operation into one understandable notice per team, **without delaying an
urgent cancellation** for batching. The bulk-import row specifies notification behavior for an import; it
does not add an import feature to this bug's scope.

Preserve a snapshot so a notice about a deleted event can still describe it.

**"Sent" means accepted by the delivery service, not read by the recipient.** Show queued, sent, partially
failed and failed states, and report skipped/opted-out recipients **separately from failures**.

## Cause

Event mutations complete after their database write without invoking `/api/notifications/send`. Where the
call does exist (series edit), its result is not checked, so a failed fan-out is invisible.

Note that even the paths which *do* call the route cannot reach their audience — see
[BUG-007](./007-push-delivery-cannot-reach-audience.md). Both must be fixed for a schedule change to
actually arrive.

## Proposed fix

Commit the schedule change and a durable notification job together, following the D3 matrix. The durable
job/retry architecture is an engineering decision, not settled by D3.

Separate **database success** from **notification queue/provider status** in the UI — a coach must be able
to tell "saved but not yet sent" from "sent."

## Regression test

Drive the tests off the D3 matrix rather than asserting unconditional dispatch. The essential cases:

- cancel an upcoming practice — notifies, and cannot be suppressed
- bulk series create — **one** summary per team, not one per occurrence
- edit a historical event — **no** notification
- save with no actual change — **no** notification
- title-only edit — no notification unless explicitly requested
- delete an already-canceled event — no second cancellation notice
- a failed dispatch surfaces as a failed/partially-failed state rather than being swallowed
- opted-out recipients are reported as skipped, not as failures
