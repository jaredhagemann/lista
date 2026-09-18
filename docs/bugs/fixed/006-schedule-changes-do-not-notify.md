# BUG-006 — Schedule changes send no notification to families

**Severity:** P1
**Status:** Fixed — SQL checks verified in production 2026-09-17; delivery check pending
**Reported:** 2026-09-04 by readiness review (finding 6)
**Area:** events / notifications
**Evidence class:** Static — traced through the event UI; no live dispatch observed. Fix **unverified in deployment**
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
[BUG-007](../007-push-delivery-cannot-reach-audience.md). Both must be fixed for a schedule change to
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

---

## Fix as implemented

**Branch:** `fix/006-schedule-change-notifications`
**PR:** #64
**Migration:** `supabase/migrations/20260917000007_notification_jobs.sql`

**Decisions taken, 2026-09-17 (user):** enqueue from the database, fold BUG-007's *event* fan-out into this
change, surface status minimally, and — because the hosting plan runs each cron job at most once a day, and
not punctually — carry delivery on the immediate send rather than on a frequent sweep.

### Enqueueing happens in the same transaction as the change

A trigger on `events` writes a `notification_jobs` row for the cases D3 says a coach cannot suppress: a
change to start, end or arrival time or to location, and cancel, restore or delete of an upcoming or
in-progress event. Because it lives in the database, no UI path can forget it — including BUG-009's
`apply_series_edit` and `delete_event_occurrence`, which never went near the old notification call.

Quiet by construction, all covered by tests: a title-only edit, a save that changed nothing, anything on a
historical event (judged by `end_time`, so an in-progress event still counts as live), a second notice for
deleting an already-cancelled event, and a whole team being deleted — its events cascade away with nobody
left to tell.

The suppressible cases stay with the app, through `enqueue_event_notification()`: creating an event, which
notifies by default with a switch to turn it off, and a title-only edit, which offers the opposite default.

**Batching.** The job's `batch_key` is the transaction id, team and action, so every row one operation
touches collapses into a single job carrying an `occurrence_count`. A series edit across twelve occurrences
sends one notice that says twelve, not twelve notices.

**Snapshot.** Each job stores the event's title, times, arrival time and location name, so a notice about a
deleted event can still describe it. `event_id` deliberately has no foreign key for the same reason.

### Sending, and what "sent" means

`/api/notifications/drain` claims pending jobs through `claim_notification_jobs()` — `for update skip
locked`, attempts counted on claim — so two simultaneous pings cannot send the same job twice. The app pings
it right after a save, and daily crons sweep up anything left behind: `/api/cron/notifications` at midnight
and the existing reminders run at noon. Two sweeps because this plan runs each cron job only once a day, so
a stranded notice waits at most twelve hours rather than a full day.

Recipient resolution moved to the service role, which is where BUG-007's event half is fixed: the old
fan-out resolved recipients through the caller's own client, so other people's push tokens were invisible to
it. Managed players resolve to their guardians' addresses and devices, and a guardian with two children on
the team is told once.

Every attempt writes a `notification_deliveries` row: `sent`, `failed`, or `skipped` with a reason
(`opted_out`, `no_address`, `no_subscription`). A job is `sent` when nothing failed, `partial` when some did,
`failed` when all did — so a family who turned email off never reads as a delivery failure. A job that keeps
throwing is retried up to five times and then left for a person to look at.

### What a coach sees

The save toast distinguishes saved from sent ("Event cancelled — Notified 12 · 2 skipped"), and the event
page shows the last notice's state, including "Queued — sending shortly" while it is still waiting.

**Not changed:** `/api/notifications/send` is now unused by the app and marked deprecated in place. It still
resolves recipients through the caller's client, which is BUG-007's defect; retiring it belongs with that
ticket, alongside the chat fan-out and mobile tokens. Bulk notices summarise the operation ("12 occurrences
of Practice") rather than listing field-level diffs; D3 asks for one understandable notice, not a diff, and
the per-field list now appears in the series preview before applying instead.

## Verification

**Tests:** `tests/rls/notification-jobs.test.ts` (19) and `apps/web/tests/notification-dispatch.test.ts` (12).

Against the unfixed code every enqueue test fails, because nothing enqueued at all:

```
× cancelling an upcoming event enqueues one job that describes it
× deleting an upcoming event enqueues a job that still describes the deleted event
× one bulk update across many occurrences enqueues a single job for the team
```

The D3 matrix is the test list: mandatory cases (cancel, restore, time change, location change, delete),
silent cases (title-only, no-op save, historical, already-cancelled, whole-team delete), batching (one job
per operation, separate operations stay separate), the app-enqueued cases with their authorization, claiming
(claimed once, reclaimed after a stall, abandoned after five attempts, not callable by a client), and
visibility (admins read status; members, outsiders and direct writes refused).

The dispatch tests cover D3's vocabulary: opted-out and unreachable recipients are skipped rather than
failed, a guardian is told once however many children they have on the team, and job status is sent /
partial / failed accordingly.

Two regressions this work surfaced, both now covered:
- deleting a **team** raised a foreign-key error, because the cascade fired the trigger for a team that was
  already gone (`tests/rls/team-deletion.test.ts` and `tests/rls/event-series.test.ts` caught it)
- `revoke execute … from authenticated` left PUBLIC's default grant in place, so a signed-in user could call
  the enqueue helper directly; the revoke now names `public` too

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1): RLS **388 passed**, `apps/web`
**768 passed**, `tsc --noEmit` clean, eslint clean, generated types in sync with the local database.

**Not covered by tests:** the send glue itself — the Resend and web-push calls — is exercised only by the
manual check below, as before.

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. The trigger exists
select tgname from pg_trigger where tgname = 'events_enqueue_notification';

-- 2. Clients cannot enqueue or claim directly
select has_function_privilege('authenticated', 'enqueue_notification_job(uuid, uuid, text, jsonb)', 'execute') as can_enqueue,
       has_function_privilege('authenticated', 'claim_notification_jobs(integer)', 'execute') as can_claim;

-- 3. Nothing is stuck
select status, count(*) from notification_jobs group by status;
```

Expected:
1. One row.
2. Both `false`.
3. Only `sent` (plus `partial` or `failed` if a provider genuinely failed); no growing `pending` backlog.

**After deploy, the manual check that reproduces the report:** on a team with a subscribed parent, cancel an
upcoming event. The parent should receive the email and push, the toast should read "Event cancelled —
Notified N", and the event page should show the delivery line. Then edit only the title: nobody is notified
unless the switch is on.

**Deployed 2026-09-17** (PR #64, with the cron correction in PR #65):
- The staging checks passed before merge.
- The production SQL checks passed (user): the trigger exists, clients cannot enqueue or claim, and no
  backlog is building.
- **Still to confirm:** the manual delivery check — cancelling an upcoming event and watching the email and
  push arrive for a subscribed parent. Until that runs, production dispatch is verified only at the database
  boundary.
