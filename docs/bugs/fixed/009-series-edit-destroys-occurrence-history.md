# BUG-009 — Editing a recurring series destroys availability responses, results and exceptions

**Severity:** P1
**Status:** Fixed — verified in production 2026-09-17
**Reported:** 2026-09-04 by readiness review (finding 9)
**Area:** events
**Evidence class:** Mixed — FK cascade loss and head-delete loss Reproduced (local stack, 2026-09-17); full editor workflow Static. Fix verified in production 2026-09-17
**Last verified:** `5acde1074`, local stack + code inspection, 2026-09-04

## Symptom

Changing anything on a recurring series — a venue, say — deletes every child occurrence and rebuilds it
with new IDs. Prior availability responses, game results/scores, per-occurrence cancellations and exceptions are lost, past
events are rewritten, and links to old child IDs break.

## Reproduction

**Evidence split:** the **FK cascade loss was reproduced** by probe. The **full editor workflow** —
delete-all-children-and-reinsert, results clearing, past-event rewriting — is a **static** trace of the
editor, not a live run.

1. Create a weekly series with several past and future occurrences.
2. Record a player's availability for one occurrence; record a score on a past one.
3. Edit the series (change the location) and apply to the whole series.

**Expected:** occurrence identity and existing responses/history survive an edit.
**Actual:** child occurrence availability-row count fell from 1 to 0 in the probe; results are explicitly cleared; cancellation
state and exceptions are not preserved.

## Evidence

- Series rewrite: `apps/web/src/components/calendar/event-detail.tsx:319`
- Availability foreign key (`ON DELETE CASCADE`): `supabase/migrations/20260101000000_initial_schema.sql:56`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Cause

The editor updates the parent, deletes all children, and inserts replacements with fresh UUIDs. Availability
rows reference events with `ON DELETE CASCADE`, so they are removed with the children. Past children are
included in the rewrite. Because delete and insert are separate requests, a failure between them leaves a
partially rebuilt schedule.

## Product decisions

**D4 resolved — September 15, 2026:**

- Use “availability” for the player's event response, whether entered by the player or their guardian.
- Date, time and venue changes leave availability responses unchanged. Restoration also preserves the
  saved responses. D3 notifications give players/guardians the opportunity to update availability.
- Do not add a reconfirmation state, stale-response flag or separate confirmation data. Existing
  availability continues to count normally after a schedule change.
- Offer this occurrence, this and following occurrences, or all upcoming occurrences as edit scopes.
  Bulk series edits leave past events untouched; historical corrections are explicit single-event edits
  with retained history.
- Preserve occurrence identities, links, results and availability history. Preserve individually canceled
  or rescheduled exceptions during bulk edits.
- Removed dates are canceled/archived with their records retained. Newly added occurrences have no
  availability responses. Preview affected dates before applying recurrence changes.
- Apply the operation atomically and notify according to D3's batching rules.

See [D4 decision record](../../reviews/2026-09-15-bug-backlog-review.md#d4--what-happens-to-availability-responses-and-exceptions-when-a-series-changes-009-010).

**Implementation decisions — user, 2026-09-17:**

| Question | Decision |
| --- | --- |
| Edit scope labels | **This event** · **This and following** · **Entire series**. "Entire series" is D4's "all upcoming": every remaining occurrence, with a note that past events are not changed. All three options are always shown. |
| Delivery | **One PR**, pattern changes and their preview included |
| Deleting an occurrence | Removes **only that occurrence**. If it is the first occurrence (the series head), the next occurrence becomes the head, so nothing else is touched. Deleting a **whole series** is a separate, explicit action that confirms how many occurrences and availability responses will be erased. |

**Found 2026-09-17: deleting the first occurrence deletes the whole series.** The first occurrence is the
parent row, and `events.parent_event_id` is `ON DELETE CASCADE`. "Delete this event" on it, from the event
page or the schedule list, removes every occurrence with its availability and results. Same data loss as the
edit path; fixed in this ticket per the decision above.

## Proposed fix

Preserve occurrence IDs and existing response/history records; support "this and future occurrences"; apply
the mutation transactionally; retain explicit exceptions and revisions. Make destructive removal a distinct,
reviewable operation.

## Regression test

Assert that after a series edit: availability values remain unchanged and count normally after date/time/
venue changes or restoration; results and individual exceptions survive; past occurrences are untouched;
and a mid-operation failure leaves the schedule intact. Verify removed dates retain history and newly
added occurrences start without availability responses. No reconfirmation model is required.

Also assert links to occurrence IDs remain stable across an edit, so a saved link or notification
reference does not break.

---

## Fix as implemented

**Branch:** `fix/009-series-edit-history`
**PR:** #62
**Migration:** `supabase/migrations/20260917000005_series_edits_preserve_history.sql`

Editing and deleting now change occurrences in place. Rows are never destroyed and rebuilt.

**Editing** offers three scopes: **This event**, **This and following** and **Entire series**.

| Piece | What it does |
| --- | --- |
| Planner (`apps/web/src/lib/events/series-edit.ts`) | Turns a bulk edit into a plan: updates to existing occurrences, cancellations, new occurrences, and the rows that move to a new series head. It starts at the opened occurrence (**This and following**) or the first upcoming one (**Entire series**). Past events are never in the plan. Only changed fields are written, and results are never bulk-edited. |
| Split | The edited range becomes its own series: its first occurrence becomes the head with the new rule. The old head keeps the earlier occurrences, with its rule ending the day before. Nothing is deleted or re-created, so ids, links, availability and results survive. |
| Exceptions | Cancelled occurrences, and occurrences moved off their pattern slot, keep their own date and time. Other field changes still apply to them. |
| Pattern changes | Dates dropped from the pattern are **cancelled**, keeping their availability. Newly added dates are new rows with no responses. A new occurrence is not added on a date an exception already holds. Before a pattern change applies, a preview lists what will be updated, cancelled, added, and left as is. |
| `apply_series_edit(head, plan)` | Applies the plan in **one transaction**. Runs with the caller's privileges (events RLS still applies), checks team admin, and refuses a plan that references events outside the series or reuses an existing id (`PLAN_OUTSIDE_SERIES` / `PLAN_INVALID`, nothing written). |
| `SeriesEditForm` (`apps/web/src/components/calendar/series-edit-form.tsx`) | The bulk editor. It has time-of-day fields, since dates come from the pattern. The old series branch of `EventEditForm`, which updated the parent, deleted every child and re-inserted them, is removed. `EventEditForm` now edits one event only. |
| Pattern start pinned | New rules carry `DTSTART`, so the pattern no longer depends on the head row's current start time. Editing only the head occurrence pins the start of a legacy rule first, so the other occurrences keep their dates. |

**Deleting:**

| Piece | What it does |
| --- | --- |
| `events.parent_event_id` | Was `ON DELETE CASCADE`, so deleting the first occurrence deleted the series. Now `NO ACTION`: a head with occurrences can't be deleted directly. Deleting a team still removes its events, because the constraint is checked at the end of the statement. |
| `delete_event_occurrence(id, promoted_head_rule)` | Deletes one occurrence. When that is the head, the next occurrence takes over the rule, with its start pinned, and the rest are re-pointed to it. Used by the event page and the schedule list. |
| `delete_event_series(id)` | Deletes every occurrence and returns the count. It is only reachable from the event page's delete dialog through **Entire series…**, which then confirms the number of events and availability responses to be erased. The confirmation suggests ending the series with an earlier "Repeat until" as a way to keep its history. |

**Also fixed:** "Repeat until" now includes that day (`untilEndOfDay`), both in the series editor and when creating a series. This was
[BUG-010](../010-event-time-and-recurrence-boundaries.md) symptom 1.

**Out of scope:** D3 notification batching (BUG-006). A bulk edit sends one `series_updated` notification, as before.

## Verification

**Tests:**

| Test | Against the unfixed code |
| --- | --- |
| `tests/rls/event-series.test.ts`: "deleting the series head directly does not delete the other occurrences" | **Failed:** expected 7 remaining occurrences, got 0 |
| `tests/rls/event-creation.test.ts`: "deleting the parent event directly does not cascade…" | Rewritten: it previously asserted the cascade |
| `tests/rls/event-series.test.ts`, other tests: head promotion keeps availability; child delete; explicit series delete; team deletion still cascades; `apply_series_edit` keeps ids, availability and past rows; shortening cancels without losing responses; extending adds rows with no responses; out-of-series plans refused atomically; non-admins refused | New functions, no unfixed equivalent |
| `apps/web/tests/series-edit-plan.test.ts` (24 tests, Pacific time): scopes and split; the series of the opened occurrence after an earlier split; ids kept; time change across DST; cancelled and rescheduled exceptions; no bulk results; legacy rules; extend, shorten, inclusive until, weekday change, biweekly | New planner. The split-series case was written red first, after `apply_series_edit` refused a plan the planner had built against the wrong series. |

The old editor's delete-and-reinsert was a static trace (see Reproduction). That path is deleted, not guarded.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **364 passed**
- `apps/web` suite: **756 passed**; `tsc --noEmit` clean; eslint clean on changed files
- Root tenant/billing selection: 218 passed and the 3 unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. Deleting a series head no longer cascades ('a' = NO ACTION, was 'c')
select confdeltype from pg_constraint where conname = 'events_parent_event_id_fkey';

-- 2. The three functions exist and run with the caller's privileges
select proname, prosecdef from pg_proc
where proname in ('apply_series_edit', 'delete_event_occurrence', 'delete_event_series')
order by proname;

-- 3. No orphaned occurrences
select count(*) from events c
where c.parent_event_id is not null
  and not exists (select 1 from events p where p.id = c.parent_event_id);
```

Expected:
1. `a`.
2. Three rows, all with `prosecdef = false`.
3. `0`.

**After deploy, a manual check** on a throwaway recurring event:
- Edit **Entire series** and change the venue. Availability already given still shows.
- Change "Repeat until" to an earlier date. A preview appears, and the dropped dates show as cancelled.
- Delete the first occurrence. The rest of the series remains.
- Delete the **Entire series…**. The confirmation shows counts, and everything is gone.

**Deployed and verified 2026-09-17** (PR #62):
- The staging checks passed before merge.
- The production SQL checks passed (user).
- The manual check passed (user): editing a series, shortening it, deleting the first occurrence and deleting
  a whole series all behaved as described, with availability responses kept.
