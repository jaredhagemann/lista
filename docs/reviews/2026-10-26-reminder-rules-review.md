# Reminder rules — review log

**Purpose:** the ongoing review record for team and event reminder controls and follow-up fixes.
**Spec:** [Team notification controls, section 4](../specs/team-notification-controls.md#4-coach-reminder-controls).
**Related review:** [Team mute](2026-10-22-team-mute-review.md).
**Last reviewed:** 2026-10-26, [PR #142](https://github.com/jaredhagemann/lista/pull/142) at `fa154e1c6586f6f8bcb139d1d7be3704c31c17c6`, against base `6a306eee9f3d8eabb9d9f9df971ee48a68e1cc8e`.
**Current outcome:** request changes. RR-001 and RR-002 implemented at `89b1e526f`, awaiting review.

## Using this document as the feature changes

- Keep finding IDs stable. Add findings with the next `RR-NNN` number; do not renumber or remove earlier findings.
- Append dated entries to **Review history** with the PR, exact commit, scope, verification, and status changes.
- Update the status table and each finding's **Resolution and verification** entry. Record the fixing commit and independent verification before marking a finding resolved.
- Use **Open**, **Implemented — awaiting review**, **Resolved**, or **Accepted risk**. Record the decision and scope for accepted risks.
- Source links are pinned to the reviewed commit; line numbers describe that revision.

## Finding status

| ID | Priority | Finding | Status | Fix / verification |
| --- | --- | --- | --- | --- |
| [RR-001](#rr-001--recover-failed-and-abandoned-reminder-deliveries) | P2 | The deduplication key permanently blocks retries after a failed reminder | Implemented — awaiting review | Fixed in `89b1e526f`; reproduction now passes as a regression test |
| [RR-002](#rr-002--keep-reminder-only-series-edits-from-rebuilding-the-schedule) | P2 | A reminder-only series edit can recreate a moved occurrence and send a schedule notice | Implemented — awaiting review | Fixed in `89b1e526f`; reproduction now passes as a regression test |

## Findings

### RR-001 — Recover failed and abandoned reminder deliveries

**Priority / status:** P2 / Implemented — awaiting review.
**Source:** [reminder job insertion and conflict handling, lines 256–267](https://github.com/jaredhagemann/lista/blob/fa154e1c6586f6f8bcb139d1d7be3704c31c17c6/apps/web/src/app/api/cron/reminders/route.ts#L256-L267), together with [the worker claim excluding reminders](https://github.com/jaredhagemann/lista/blob/fa154e1c6586f6f8bcb139d1d7be3704c31c17c6/supabase/migrations/20261026000000_reminder_rules.sql#L280).

The cron inserts a unique `reminder:<event id>:<start time>` job before attempting delivery, then treats any later conflict as proof that no further work is needed. It does not inspect whether that job succeeded, failed, partially succeeded, or was left in `sending`. The worker explicitly excludes all reminder jobs, so no other path recovers them. An unsuccessful attempt now permanently consumes the event/start key, including when nothing was delivered. Before this change, rerunning the reminder cron could attempt those deliveries again.

**Reproduction:**

1. Supply one upcoming event and one email recipient to the real reminder handler, with database responses modeled to retain inserted job keys and updates.
2. Make the email provider reject its send with `provider unavailable`.
3. Verify that the handler records the job as `failed`; its response is nevertheless HTTP 200.
4. Restore the provider and rerun the handler within the same event window.

**Observed:** the second insert conflicts with the first job's batch key, so the second run makes no email attempt. The provider was called once across both runs; an expected-behavior assertion requiring a second attempt failed. The existing local RLS test also passes its assertion that an hour-old `sending` reminder is never claimed by the worker. A process interruption after inserting the job therefore has the same missing-recovery problem, although a real process interruption was not exercised.

The event page also displays “we'll retry” for a failed reminder through its shared notification-status UI, even though neither sender will retry it.

**Requested change:** distinguish successful deduplication from failed or abandoned work. Provide a safe recovery/claim path for failed and stale `sending` reminders while retaining protection against overlapping sends and against repeating successful recipient/channel deliveries. Surface unsuccessful delivery outcomes to monitoring rather than returning success for a wholly failed reminder.

**Regression coverage:** fail every delivery, recover the provider, and rerun before the event starts; the unsent deliveries must be attempted again. Also cover interruption after claiming, partial delivery, overlapping runs, completed-job deduplication, and the event page's retry wording.

**Resolution and verification:** Implemented in `89b1e526f`, awaiting review.

- **Claim:** new migration `20261027000000_reminder_retry.sql` adds `notification_jobs.claimed_at` and
  `claim_reminder_job` (service role only). It inserts a new reminder, or takes back one that is `failed`,
  `partial`, or `sending` with `claimed_at` over ten minutes old, below five attempts. It never takes one
  that is `sent` or freshly `sending`. The row lock serializes overlapping runs. On a take-back it deletes
  the job's non-sent delivery rows and returns the sent ones; the job sends only to the rest.
- **Interruption:** `sendPlanned` takes an `onOutcome` callback, and the reminders job logs each delivery as
  it's made, so a dead run leaves its sent rows and a retry doesn't repeat them.
- **Recovery path:** the reminder logic moved to `lib/notifications/reminders.ts` (`sendReminders`). The
  midnight sweep (`/api/cron/notifications`) calls it with `retryOnly`, which only takes back existing
  reminders for events that haven't started and never starts one.
- **Monitoring:** a reminder whose every delivery failed goes in `failedEvents`, so the run returns 500.
  Partial ones are listed as `partialEvents` with a 200.
- **Wording:** a failed or partial reminder on the event page now reads "we'll try again if there's time
  before it starts"; notices keep "we'll retry".
- **Tests:** `reminder-rules-cron.test.ts` covers fail → recover → resend, partial resends only the failure,
  per-delivery logging before the next send, stale take-back without resending, overlapping run, completed
  dedupe, and the midnight sweep (retries failed, starts none, reads no events when nothing failed).
  `tests/rls/team-reminder-settings.test.ts` covers the same rules against the real function, plus the
  five-attempt limit and no access for signed-in users. `reminder-status.test.tsx` covers the wording.
- **Not covered:** a real process kill mid-run; a real provider outage.

### RR-002 — Keep reminder-only series edits from rebuilding the schedule

**Priority / status:** P2 / Implemented — awaiting review.
**Source:** [the new reminder field in the series-edit input, lines 260–265](https://github.com/jaredhagemann/lista/blob/fa154e1c6586f6f8bcb139d1d7be3704c31c17c6/apps/web/src/components/calendar/series-edit-form.tsx#L260-L265), passed to [the general series planner, lines 280–289](https://github.com/jaredhagemann/lista/blob/fa154e1c6586f6f8bcb139d1d7be3704c31c17c6/apps/web/src/components/calendar/series-edit-form.tsx#L280-L289).

A reminder-only edit goes through the existing schedule-rebuilding planner. That planner skips individually rescheduled occurrences and treats their original dates as unfilled pattern slots. Consequently, changing only the series reminder can insert a replacement occurrence on the old date. The new RPC's insert-based notice condition then sends an “updated” notice, contrary to D13. The moved occurrence is also skipped for the reminder update, so it continues to follow the team default despite never having had its own explicit reminder choice.

The planner's treatment of rescheduled occurrences predates this PR. This finding concerns its newly introduced use for reminder-only edits, which are required to change notification behavior silently rather than the schedule.

**Reproduction:**

1. Create a weekly Thursday series for December 3, 10, and 17, 2026, at 16:00 UTC. Leave every occurrence's reminder at the team default (`null`).
2. Individually move the December 10 occurrence to Friday, December 11, leaving it in the series.
3. Clear the fixture's earlier movement-notice job so it cannot be confused with the reminder edit's notice.
4. Run the real `planSeriesEdit` for the entire series with only `fields: { reminder: "never" }`, without changing the time, zone, or recurrence pattern.
5. Apply that plan through the coach's authenticated `apply_series_edit` RPC against local Supabase.

**Observed:** the plan inserted one occurrence for the original Thursday slot, the RPC queued one new notification job, and the moved Friday occurrence retained `reminder: null`. An assertion expecting no inserts, no notices, and `reminder: "never"` on the moved occurrence failed with `{ inserted: 1, jobs: 1, movedReminder: null }`. No real email was sent by this probe.

**Requested change:** apply reminder-only changes without regenerating dates, inserting or cancelling occurrences, or changing recurrence ownership. Ensure a time/date exception by itself does not exclude an occurrence from the series reminder change. Define any precedence for explicit occurrence reminder overrides separately from schedule exceptions, and preserve D13's silence.

**Regression coverage:** use a series with an occurrence moved to another date and another moved within the same date. A reminder-only series edit must preserve event IDs and timestamps, create no events or notices, and update the intended reminders. Include “this and following” scope and explicit per-occurrence reminder overrides according to the settled precedence.

**Resolution and verification:** Implemented in `89b1e526f`, awaiting review.

- **Reminder-only edits skip the planner.** `seriesReminderTargets` returns every upcoming occurrence in
  scope, as `resolveSeriesEdit` finds it, including moved and cancelled ones. The series editor updates
  `reminder` on those ids in one statement. No dates are regenerated, no rows are inserted or cancelled,
  the series isn't split, and the trigger doesn't watch `reminder`, so nobody is notified.
- **Mixed edits:** `planSeriesEdit` now adds a `{ reminder }`-only update for each exception when the edit
  changes the reminder. Exceptions keep their other fields and don't appear as updated in the preview.
- **Precedence (settled, recorded in spec §4.1):** a series reminder change sets every upcoming occurrence in
  scope, overriding earlier per-occurrence choices. Editing one occurrence afterwards overrides it again.
- **Tests:** `series-edit-plan.test.ts` (targets for both scopes with moved, overridden and cancelled
  occurrences; mixed-edit exception updates). `event-reminder-field.test.tsx` (the series form saves a
  reminder-only change as one update over all ids, without `apply_series_edit`).
  `tests/rls/team-reminder-settings.test.ts` repeats the review's reproduction against local Supabase with
  one occurrence moved to the next day and one moved within its day. Every id, time, parent link, rule and
  cancellation stays the same, no events are added, no jobs are queued, and all reminders are set.
  "This and following" is covered too, and so is a mixed edit reaching a same-day move.
- **Pre-existing, not fixed here:** the planner's treatment of a date-moved occurrence still recreates its old
  date on a mixed series edit (any field, not just the reminder). That predates PR #142 and is worth its own
  bug ticket.

## Review history

### 2026-10-26 — Initial implementation, PR #142

- **Revision:** `fa154e1c6586f6f8bcb139d1d7be3704c31c17c6`, against base `6a306eee9f3d8eabb9d9f9df971ee48a68e1cc8e`.
- **Scope:** team reminder settings and RLS, event/series/tournament edit controls, silent reminder edits, daily filtering and delivery logging, and the shared send-and-record refactor. Mobile and coach-chosen reminder timing remain separate work.
- **Product decisions:** used revised D5, which permits club directors to edit reminder settings. The absence of a reminder field on tournament creation is explicitly disclosed in the PR; the field is available when editing a tournament.
- **Status changes:** opened RR-001 and RR-002, both P2. Request changes.
- **Existing unit/component tests:** **106 passed in ten files**: `reminder-rules`, `reminder-rules-cron`, `event-reminder-field`, `team-reminder-settings`, `series-edit-plan`, `series-edit-summary`, `team-mute-delivery`, `team-mutes-section`, `notification-dispatch`, and `notification-times`.
- **Existing local integration tests:** **40 passed in three files**: `team-reminder-settings`, `notification-recipients`, and `team-notification-mutes`. The running local Supabase stack already had the migration; no reset or migration was performed for this review. These runs also exercised the prior team-mute regression tests.
- **Additional review probes:** two expected-behavior assertions failed, reproducing RR-001 and RR-002. The cron probe used the real handler and delivery code with controlled recipient, database, and provider responses. The series probe used the real planner and authenticated RPC against local Supabase. Temporary probes were removed after verification; the reproduction steps and observed results are preserved above.
- **Other checks:** `git diff --check` passed for the reviewed PR diff. No full-suite rerun, real-stack browser check, native-device verification, real reminder email, staging/production verification, or independent CI validation was performed. No application or permanent test source was changed during the review.

### 2026-10-26 — RR-001 and RR-002 fixes, PR #142

- **Revision:** `89b1e526f`, on top of `fa154e1c6`.
- **Scope:** reminder claim and retry (new migration `20261027000000_reminder_retry.sql`), shared
  `sendReminders`, midnight retry, per-delivery logging, event-page wording; reminder-only series edits and
  exception reminder updates.
- **Status changes:** RR-001 and RR-002 → Implemented — awaiting review.
- **Unit/component tests:** 1,663 passed in 127 files. Type check and lint clean.
- **Local integration tests:** after a clean `supabase db reset` (both new migrations applied from scratch),
  695 passed in 53 files.
- **Not done:** a browser check, a real reminder email, staging verification.
