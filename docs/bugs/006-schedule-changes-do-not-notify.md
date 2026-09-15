# BUG-006 — Schedule changes send no notification to families

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 6)
**Area:** events / notifications

## Symptom

A coach cancels tonight's practice, sees "Event cancelled," and no parent is notified. The same is true for
event creation, individual edits, restores and deletions. Only the entire-series edit calls the
notification route, and it ignores the result.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded — the finding is a static trace of the event UI, and
a live repro (cancel an event on a team with a subscribed parent, observe no email/push) has not been run.

1. As a coach, create an event on a team with at least one parent who has notifications enabled.
2. Cancel it from the event detail sheet.

**Expected:** a cancellation notification reaches the team's families.
**Actual:** no notification is dispatched from this path.

## Evidence

- Event creation: `apps/web/src/components/calendar/event-form-dialog.tsx:228`
- Single edit: `apps/web/src/components/calendar/event-detail.tsx:381`
- Cancel / restore / delete: `apps/web/src/components/calendar/event-detail.tsx:785`

## Cause

Event mutations complete after their database write without invoking `/api/notifications/send`. Where the
call does exist (series edit), its result is not checked, so a failed fan-out is invisible.

Note that even the paths which *do* call the route cannot reach their audience — see [[007]]. Both must be
fixed for a schedule change to actually arrive.

## Fix

Commit the schedule change and a durable notification job together. Record delivery attempts, retry
failures, and surface to the coach whether the intended audience was reached.

## Regression test

Assert that create / edit / cancel / restore / delete each enqueue a notification job, and that a failed
dispatch is surfaced rather than swallowed.
