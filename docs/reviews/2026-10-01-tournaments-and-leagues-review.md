# Tournaments and leagues — review log

**Purpose:** the ongoing review record for this feature, covering the specification and each implementation part.
**Spec:** [Tournaments and leagues](../specs/tournaments-and-leagues.md).
**Last reviewed:** 2026-10-07, merged `main` at `8793d6abe69009b84886dba017990541784d9470`, including PRs #117–#120.
**Current outcome:** TL-001 through TL-015 are resolved. No new actionable findings in the merged-code review. Tournament notices and BUG-032 are present together on main. D19 settles email answer inheritance as part of the upcoming effective-availability implementation.

## Using this document as the feature changes

- Keep finding IDs stable. Add new findings with the next `TL-NNN` number; do not renumber or remove old findings.
- For each iteration, append a dated entry to **Review history** with the PR, exact commit, scope, verification, and finding status changes.
- Update both the status table and the finding's **Resolution and verification** entry. Record the fixing commit and what was checked before marking a finding resolved.
- Use **Open**, **Implemented — awaiting review**, **Resolved**, or **Accepted risk**. For an accepted risk, record the decision and its scope; acceptance does not mean the defect was repaired.
- Keep product decisions in the spec and link them here. Keep the original reproduction and evidence so later iterations can check the same failure.
- Source links below are pinned to the reviewed commit. Line numbers describe that revision, not necessarily the latest file.

## Finding status

| ID | Priority | Finding | Status | Fix / verification |
| --- | --- | --- | --- | --- |
| [TL-001](#tl-001--serialize-tournament-validation-with-parent-edits) | P2 | Concurrent edits can invalidate tournament links | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-002](#tl-002--check-existing-series-children-before-converting-a-head) | P2 | A series head can join a tournament while retaining occurrences | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-003](#tl-003--exclude-answered-games-when-selecting-bulk-answer-targets) | P2 | Bulk fill can change availability outside the selected window | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-004](#tl-004--notify-when-deletion-removes-active-child-games) | P2 | Deleting a cancelled or ended tournament can silently remove active games | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-005](#tl-005--snapshot-retained-games-before-unlinking-them) | P2 | Cancellation loses the game details needed by its notification | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-006](#tl-006--suppress-creation-notices-for-completed-tournaments) | P2 | Historical tournament creation queues a notification | Resolved | Fix `5e00b4d06`; independently verified at `82005445b` |
| [TL-007](#tl-007--revalidate-games-before-applying-a-tournament-cancellation) | P2 | Cancellation can change a game concurrently moved to another tournament | Resolved | Fix `b80893172`; independently verified at `99bab47c` |
| [TL-008](#tl-008--guard-the-edit-url-for-tournaments) | P2 | The edit URL still opens the single-event editor for tournaments | Resolved | Fix `c5ca6d6f5`; verified at `f7f3e62cf` on 2026-10-05 |
| [TL-009](#tl-009--keep-the-tournament-zone-in-calendar-reads) | P2 | Travel tournaments show incorrect calendar date labels | Resolved | Fix `c5ca6d6f5`; verified at `f7f3e62cf` on 2026-10-05 |
| [TL-010](#tl-010--name-a-tournament-where-its-visible-month-segment-begins) | P2 | A tournament crossing a month boundary can have no visible name | Resolved | Fix `c5ca6d6f5`; verified at `f7f3e62cf` on 2026-10-05 |
| [TL-011](#tl-011--show-each-games-result-independently-of-its-score) | P2 | Tournament game rows omit results entered without scores | Resolved | Fix `c5ca6d6f5`; verified at `f7f3e62cf` on 2026-10-05 |
| [TL-012](#tl-012--reject-games-that-end-at-or-before-their-start) | P2 | New game forms save invalid time ranges | Resolved | Fix `a0642c8dd`; verified at `a3baa09c6` |
| [TL-013](#tl-013--apply-the-selected-location-to-games-created-with-the-tournament) | P2 | Games created with a tournament lose the selected venue | Resolved | Fix `a0642c8dd`; verified at `a3baa09c6` |
| [TL-014](#tl-014--keep-placement-only-edits-silent) | P3 | Placement-only edits can queue an update notice | Resolved | Fix `a0642c8dd`; verified at `a3baa09c6` |
| [TL-015](#tl-015--handle-tournament-game-read-errors-before-sending-reminders) | P2 | Failed game reads silently send incomplete tournament reminders | Resolved | Fix `3d2818211`; verified at `af20d2f66` and merged main `8793d6abe` |

## Implementation progress as of 2026-10-07

| Area | Status | Completed behavior / remaining scope |
| --- | --- | --- |
| Specification | Decided | Tournament and league design, D1–D19 |
| Tournament database, #114 and #115 | Merged | Tournament/game links, placement and rounds, indexes, atomic create/cancel/delete, bulk-answer rules, durable notification snapshots and concurrency fixes |
| Tournament web display, #116 | Merged | Overlap queries, schedule rows and calendar bars, tournament/game detail links, placement and record display, dashboard treatment |
| Tournament web management, #117 | Merged; part 2c dependency now present on main | Create with games; edit days, zone, location, notes and placement; add games; cancel both ways, restore, delete; game round editing and outside-days warnings |
| Tournament notices, part 2c | Merged via #120 after #118 landed on its feature base; TL-015 resolved | Tournament template, per-action links and answers, cancelled/kept/deleted game lists, "Part of" on game notices and reminders, tournament reminders |
| Deleted standalone-event links, #119 / BUG-032 | Merged and reviewed | Deleted notices open the schedule in email and push; cancelled notices retain their event link; tournament routing remains intact |
| Effective availability in web UI and email | Implemented — awaiting review, PR #121 (`ce960e427`), including D19 | Inherited answers, game overrides and clearing, response lists, coach grid, unanswered counts and game email/reminder answer labels; existing tournament bulk-fill database rules alone do not complete this |
| Tournament mobile support | Pending | Dedicated display and inherited answers; existing 1.0.12 behavior remains the accepted rollout difference |
| Leagues | Pending | Team leagues/seasons, tagging, records, management and mobile display |

## Part 1 — database findings

TL-001 through TL-006 were initially reproduced against the local Supabase database with migration
`20261001000000_tournaments.sql` applied. Their fixes and TL-007 were checked with
`20261001000001_tournaments_review_fixes.sql` applied. These are not claims about observed production behavior.
The web and mobile implementation, including the tournament notification template, are later parts;
their absence is not a finding in this review.

### TL-001 — Serialize tournament validation with parent edits

**Priority / status:** P2 / Resolved.
**Source:** [`events_check_tournament_links`, line 76](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L76-L82), together with the parent-edit check at lines 101–104.

The parent lookup takes no lock. A parent type or team update and a new game link can each validate
against an earlier state, then both commit. The foreign key protects the parent's ID, but not these
additional invariants.

**Reproduction:**

1. Create an empty tournament `T`.
2. In transaction A, change `T.event_type` to `other` and leave the transaction uncommitted.
3. In transaction B, insert a game with `tournament_id = T.id`, then commit.
4. Commit transaction A.

**Observed:** both transactions committed; the game's linked parent had `event_type = 'other'`.
Changing the parent's team has the same uncoordinated validation paths, but that variant was not
separately executed.

**Requested change:** coordinate locking and validation between child-link writes and parent type/team
edits. Neither commit order should permit a game to reference a non-tournament or another team's tournament.

**Regression coverage:** use two database connections to exercise the overlap above, the team-change
variant, and valid same-team linking. Assert the final relationship is valid or one operation is rejected.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
Linking a game now reads its tournament `FOR SHARE`, which conflicts with any update to the tournament row.
The foreign key alone takes `FOR KEY SHARE`, which doesn't. An occurrence reads its series head the same way.
So whichever transaction commits second is validated against the first: a link waits for a type or team change
and is then refused, or a type or team change waits for a link and is then refused by the existing
`TOURNAMENT_HAS_GAMES` check.
Implementation verification (reported with `5e00b4d06`): `tests/rls/tournaments-review.test.ts` → "TL-001", with two real `psql` sessions. One holds
its transaction open for 2 seconds while the other runs. It covers the reported order, the reverse order, the
team-change variant, and a valid link. The three overlap tests failed before the fix (both sessions committed),
and they assert that the two can't both succeed and that no invalid link remains.

Independent follow-up verification: two authenticated-admin database sessions confirmed that a type change before a link, a link before a type change, and a team change before a link each reject one conflicting operation. All three ended with zero invalid links.

### TL-002 — Check existing series children before converting a head

**Priority / status:** P2 / Resolved.
**Source:** [`events_check_tournament_links`, lines 86–95](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L86-L95).

The trigger checks a row's outgoing `parent_event_id`, but does not check whether other events already
point to that row as their series head. Clearing the head's recurrence rule satisfies the new row check
without detaching its existing occurrences.

**Reproduction:**

1. Create tournament `T`, recurring game head `H`, and an occurrence `C` with `parent_event_id = H.id`.
2. Update `H` with `recurrence_rule = null` and `tournament_id = T.id`.
3. Call `delete_tournament(T.id)`.

**Observed:** the update succeeded, leaving `C` attached to a tournament game. Deleting the tournament
then failed the `events_parent_event_id_fkey` foreign key. Converting `H` into a tournament while clearing
its rule reaches the same missing inbound-link check; that variant was identified by inspection.

**Requested change:** reject tournament conversion or attachment when the event still has series children,
in addition to checking its own recurrence fields. This preserves D18's standalone-only rule in both directions.

**Regression coverage:** test both attachment and type conversion of an existing head with children;
verify rejection preserves the original series. Keep the legitimate standalone conversion/link cases covered.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
The trigger refuses an update that makes an event a tournament, or links it to one, while any event still has
`parent_event_id` pointing at it (`TOURNAMENT_NOT_A_SERIES`). Clearing its own rule no longer gets around
D18.
Implementation verification (reported with `5e00b4d06`): "TL-002" covers joining a tournament and becoming one, each with the rule cleared; both are
refused, and the series (head rule, child link) is unchanged. The legitimate standalone cases still succeed.
Both refusal tests failed before the fix.

Independent follow-up verification: attaching a head with existing children and converting that head to a tournament both raised `TOURNAMENT_NOT_A_SERIES` in rolled-back SQL probes.

### TL-003 — Exclude answered games when selecting bulk-answer targets

**Priority / status:** P2 / Resolved.
**Source:** [`set_unanswered_availability`, lines 527–542](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L527-L542).

Time eligibility is checked on the source game, while answer existence is checked only on its tournament.
An already-answered game can therefore pull an otherwise out-of-window tournament into the bulk operation.

**Reproduction:**

1. Create a tournament that started yesterday, with no tournament answer.
2. Give its game tomorrow an explicit Unavailable response.
3. Leave another game nine days from now unanswered.
4. Bulk-fill Available for the next two days, with no event-type filter.

**Observed:** there were zero unanswered events inside the selected window, but the RPC inserted one
tournament answer. The game nine days away then had an effective Available answer through inheritance.
The existing web confirmation promises to fill unanswered future events within the selected dates.

**Requested change:** already-answered source games must not promote an otherwise out-of-window
tournament into the operation. Preserve the deliberate support for reaching an underway tournament through
an eligible unanswered game, and D16/D16b's prohibition on creating game overrides through bulk fill.

**Regression coverage:** reproduce the window and override combination above and assert no answer is
inserted. Also cover an eligible unanswered game, an existing tournament answer, and the standalone-only
`game` filter.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
A game in the window now stands for its tournament only while the game itself is unanswered. The fill
requires no answer on the source event as well as on the target. An answered game no longer promotes an
out-of-window tournament.
Implementation verification (reported with `5e00b4d06`): "TL-003" reproduces the report: an underway tournament, tomorrow's game answered
Unavailable, a game nine days out, and a two-day fill. Nothing is inserted; this failed before the fix. It
also covers an unanswered game in the window still reaching the underway tournament, and an answered
tournament with the standalone-only `'game'` filter.

Independent follow-up verification: the original answered-game/window case inserted zero rows. Removing the source game answer made the same fill insert exactly one tournament answer, preserving the intended underway-tournament behavior.

### TL-004 — Notify when deletion removes active child games

**Priority / status:** P2 / Resolved.
**Source:** [`delete_tournament`, lines 390–398](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L390-L398).

The function suppresses game notifications, then decides whether to send the replacement tournament
notice using only the parent's cancellation status and end time. A cancelled or ended parent can still
have active future games.

**Reproduction:**

1. Create a tournament with a future game, without a creation notice.
2. Cancel the tournament and its game.
3. Restore the game individually, leaving the tournament cancelled.
4. Delete the tournament with `delete_tournament`.

**Observed:** the active future game was deleted and zero deletion notices were queued.
A game rescheduled beyond an ended tournament's dates has the same suppression problem; that variant
was identified by inspection. The spec permits games outside the tournament's dates.

**Requested change:** decide notification eligibility from the affected games as well as the parent,
preserving one notice for the operation. Suppress the notice only when no affected event requires one.

**Regression coverage:** cover a cancelled parent with an active future game, an ended parent with a
future game, and entirely historical or already-cancelled events. Assert exactly one notice when an
active upcoming/in-progress event is removed, and none when every affected event is silent history.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
`delete_tournament` records, before deleting, which games are live (not cancelled, not over). It sends its
one notice when the tournament is live **or** any game is.
Implementation verification (reported with `5e00b4d06`): "TL-004" covers a cancelled tournament with a restored future game and an ended tournament
with a game moved past it: exactly one `deleted` notice each, both failing before the fix. A tournament and
games that are all history send none.

Independent follow-up verification: both a cancelled parent with a restored future game and an ended parent with a future game produced exactly one deletion job.

### TL-005 — Snapshot retained games before unlinking them

**Priority / status:** P2 / Resolved.
**Source:** [`cancel_tournament`, lines 442–443](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L442-L443), and the notification payload at lines 264–267.

Cancelling while keeping games clears their tournament association and round, then queues only counts
and `games_action = 'kept'`. The spec requires the cancellation notice to list those retained games.
The later worker cannot identify them after their association has been removed.

**Reproduction:**

1. Create a tournament with two future games.
2. Call `cancel_tournament` with `p_cancel_games = false`.
3. Inspect the games and the queued job's `snapshot.tournament`.

**Observed:** neither game retained a tournament link. The snapshot contained only
`{"games": 2, "affected": 2, "games_action": "kept"}`, with no game IDs or display details.

**Requested change:** capture the affected games before unlinking them and include their IDs and display
details in the durable notification snapshot. This is the database-to-worker contract needed by part 2,
not a request to implement the deferred email template in part 1.

**Regression coverage:** include an unrelated standalone game and verify the snapshot contains exactly
the retained tournament games. Their details must remain usable after unlinking and subsequent edits/deletion.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
Every tournament notice now carries `snapshot.tournament.affected_games`, from
`tournament_game_summaries`: each game's id, title, times, zone, opponent, home/away, round and
cancellation. It's captured before the action unlinks, cancels or deletes them. `affected` is now that
list's length. The contract is in the spec (§4, Notifications).
Implementation verification (reported with `5e00b4d06`): "TL-005" cancels keeping games, with an unrelated standalone game present, then deletes one
of the unlinked games. The notice still lists exactly the two retained games, with their details. Creating
lists its games too. Both failed before the fix.

Independent follow-up verification: after keeping two games and subsequently deleting one, the cancellation snapshot still held exactly those games and their original rounds, excluding an unrelated standalone game. The separate concurrent-mutation problem introduced by collecting IDs before the update is tracked as TL-007.

### TL-006 — Suppress creation notices for completed tournaments

**Priority / status:** P2 / Resolved.
**Source:** [`create_tournament`, lines 361–363](https://github.com/jaredhagemann/lista/blob/18b0da0a67b7d4ebaefeca0a2a179f26c7988c63/supabase/migrations/20261001000000_tournaments.sql#L361-L363).

`p_notify` defaults to true, and the function enqueues a created notice without checking whether the
tournament has ended. Existing event notification handling refuses completed events; the spec retains
the rule that historical events do not notify.

**Reproduction:** create a tournament from ten days ago through eight days ago, with no games, leaving
`p_notify` at its default.

**Observed:** a `created` job was queued for the historical tournament.

**Requested change:** apply the corresponding time check before enqueueing. Preserve historical data
entry without sending families a new-event notice for a completed tournament.

**Regression coverage:** historical creation with notification requested queues nothing; upcoming
creation queues one notice; `p_notify = false` queues none.

**Resolution and verification:** Resolved in the follow-up review at `82005445b`. Implemented in `5e00b4d06` (PR #114), migration `20261001000001_tournaments_review_fixes.sql`. A second migration, because staging already had `20261001000000`.
`create_tournament` notifies only when `p_notify` is set and the tournament hasn't ended, matching
`enqueue_event_notification`'s rule for single events. Past tournaments can be entered silently.
Implementation verification (reported with `5e00b4d06`): "TL-006" covers historical creation with notify requested (no job; this failed before the
fix), upcoming creation (one job), and `p_notify = false` (none).

Independent follow-up verification: historical creation with the default notification setting produced zero jobs; future creation produced one.

### TL-007 — Revalidate games before applying a tournament cancellation

**Priority / status:** P2 / Resolved.
**Source:** [`cancel_tournament`, lines 350–360](https://github.com/jaredhagemann/lista/blob/82005445befca94d176147a6b5a1c1a0a5960997/supabase/migrations/20261001000001_tournaments_review_fixes.sql#L350-L360).

The fix captures eligible game IDs and their summaries without locking those rows, then updates by ID
alone. If another transaction moves a game before the update acquires its row lock, cancellation still
acts on the captured ID even though that game no longer belongs to the tournament being cancelled.
The previous implementation's update also filtered by tournament membership and start time; the new
ID-only update drops that revalidation.

**Reproduction:**

1. Create tournaments `T1` and `T2`, with a future game `G` linked to `T1`.
2. In transaction A, update `G.tournament_id` to `T2.id`, leaving the transaction uncommitted.
3. In transaction B, call `cancel_tournament(T1.id, true)`. Its reads see the previously committed link
   to `T1`, so it captures `G.id`; its subsequent update waits for A's row lock.
4. Commit A and let B complete.

**Observed:** both authenticated-admin transactions committed. `G` belonged to `T2` but was cancelled
by the operation on `T1`. Repeating with `p_cancel_games = false` also let both commit and cleared `G`'s
new `T2` link entirely, leaving it standalone. Both variants were reproduced locally at `82005445b`.

**Requested change:** lock and revalidate the eligible game rows before taking their snapshots and
applying the action. A game moved out of the tournament must not be cancelled or unlinked by an action
on its former tournament. Keep the affected count and durable snapshot consistent with the rows actually
changed; do not rely solely on IDs selected before a concurrent edit commits.

**Regression coverage:** use two database sessions to overlap a game move with both cancellation choices.
Assert either a coordinated rejection or preservation of the successfully moved game's new membership and
active status. Verify the notice excludes games not actually changed, and keep ordinary cancellation and
retained-game snapshot cases passing.

**Resolution and verification:** Resolved at `99bab47c` on 2026-10-02. Fixed in `b80893172`, migration
`20261002000000_tournaments_lock_games.sql`. That's a new migration, because #114 had already merged with
TL-007 open.
- **The fix:** `cancel_tournament` checks the caller first, then locks the tournament (`FOR UPDATE`) and its
  eligible games (`FOR UPDATE`, filtered by membership, start time and, for the cancel choice, not already
  cancelled). Only then does it summarize, count or change anything.
  - Under read committed, a game that changed while the lock waited is re-checked against the filter, so a
    game moved to another tournament drops out.
  - The summary, `affected`, and the update all cover exactly the locked rows.
- **Lock order:** the admin check comes before the lock, because `FOR UPDATE` only returns rows the caller
  may update. That would have turned "not authorized" into "not found" (an existing test caught this).
- **The same gap in `delete_tournament`, found while fixing this:** it summarized its games, and decided
  whether any were live, before its delete re-checked membership. A game moved away could be listed in the
  notice, or send one, without being deleted. It now locks the same way and deletes exactly the locked
  games.
- **Implementation verification:** `tests/rls/tournaments-review.test.ts` → "TL-007", with two `psql`
  sessions. One moves the game to the second tournament and holds its transaction open. The other calls the
  action as the coach, under the `authenticated` role and the coach's JWT claims.
  - It covers cancelling with games, cancelling keeping games, and deleting. Each asserts the moved game keeps
    its new tournament and isn't cancelled, and that the notice lists no game.
  - All three failed before the fix.
  - Ordinary cancellation still changes and lists its game.
  - All 44 tournament tests pass, and the full RLS suite passes after `supabase db reset` (47 files, 605
    tests).

Independent verification on 2026-10-02: repeated the two-session move with both cancellation choices
and deletion, using authenticated coach claims for both sessions against the local database. The moving
transaction signalled after its update and held its lock while the action started. All three preserved
the new tournament and active status, with exactly one notice containing zero affected games. Ordinary
cancellation changed and listed exactly its game. Isolated fixtures were removed afterward.

## Part 2a — web display findings

These findings concern PR #116 at `6a10d65636eb04a82beb3d120e8d123d5b0b350b`. Creation and tournament
management in part 2b, notices in part 2c, and later mobile work are deliberately outside this review.

### TL-008 — Guard the edit URL for tournaments

**Priority / status:** P2 / Resolved.
**Source:** [event-detail.tsx, line 901](https://github.com/jaredhagemann/lista/blob/6a10d65636eb04a82beb3d120e8d123d5b0b350b/apps/web/src/components/calendar/event-detail.tsx#L901), with the edit-state initializer at lines 657–660 and the edit form at lines 825–855.

The new tournament guard hides the Edit button, but the existing `?edit=true` entry point still sets
`editState` to `single` for an authenticated admin. The component returns `EventEditForm` before it
reaches the guarded controls. That form offers ordinary event types and arbitrary start/end times; it
can save a tournament with non-midnight bounds without the future tournament editor's game-date checks.
For an empty tournament it can also change the event type away from tournament.

**Reproduction / evidence:** trace an uncancelled standalone tournament through the page's
`initialEdit={edit === "true"}` and the initializer. With `initialEdit=true` and `isAdmin=true`, it opens
the ordinary editor. Existing new tests cover only the normal page with `initialEdit=false`.

**Requested change:** guard edit-state initialization and rendering for tournaments until their editor
is available. Add a regression case for `initialEdit=true`, retaining normal game editing.

**Resolution and verification:** Resolved on 2026-10-05 at `f7f3e62cf`. Fixed in `c5ca6d6f5` (PR #116).
- **The fix:** both the edit-state initializer and the editor's render check `isTournament(event)`. A
  tournament opened with `?edit=true` shows its page, not the single-event editor, until part 2b adds its
  own editor.
- **Implementation verification:** `tests/tournament-event-page.test.tsx` → "TL-008".
  - A tournament with `initialEdit` shows its page and games, with no event editor. This failed before the
    fix.
  - A game with `initialEdit` still opens the editor.

**Follow-up verification (2026-10-05):** Source review confirms both initialization and render guards. CI at the reviewed head passes the regression that opens a tournament with initialEdit=true and the control case that still opens a game editor.

### TL-009 — Keep the tournament zone in calendar reads

**Priority / status:** P2 / Resolved.
**Source:** [schedule-calendar.tsx, line 434](https://github.com/jaredhagemann/lista/blob/6a10d65636eb04a82beb3d120e8d123d5b0b350b/apps/web/src/components/calendar/schedule-calendar.tsx#L434), and [queries.ts, lines 122–123](https://github.com/jaredhagemann/lista/blob/6a10d65636eb04a82beb3d120e8d123d5b0b350b/apps/web/src/lib/events/queries.ts#L122-L123).

The new calendar tooltip calls `tournamentDates(event, gridZone)`, but the real calendar projection and
its row type omit `timezone`. The helper therefore labels the tournament in the team's calendar zone
instead of the tournament's own zone, contrary to D13 and the list/detail date labels.

**Reproduction / evidence:** a New York tournament Dec 11–13, 2026 is stored from
`2026-12-11T05:00:00Z` through `2026-12-14T05:00:00Z`. With a Los Angeles calendar, executing the
actual helper on the projected row returns **Thu, Dec 10 – Sun, Dec 13**. Keeping its New York timezone
returns the correct **Fri, Dec 11 – Sun, Dec 13**. Calendar component tests pass full event fixtures,
including timezone, which the real query does not return.

**Requested change:** include timezone in the calendar projection and its type, and verify calendar
labels with a tournament whose zone differs from the team's. Decide day-cell placement separately from
the tournament's own date label; the label must preserve the tournament dates.

**Resolution and verification:** Resolved on 2026-10-05 at `f7f3e62cf`. Fixed in `c5ca6d6f5` (PR #116).
- **The fix:** the calendar projection and `CalendarEventRow` include `timezone`, so `tournamentDates`
  reads the tournament's own zone.
- **Day-cell placement, decided separately as asked:** a tournament is all-day, so it sits on its own dates,
  `tournamentDayKeys(event, event.timezone ?? gridZone)`. A Fri–Sun tournament occupies the Fri–Sun cells
  on any team's calendar, rather than shifting to Thu–Sun for a calendar in a zone to its west. Other events
  are placed by the calendar's zone, as before.
- **Implementation verification:**
  - `tests/event-range.test.ts` asserts that the calendar projection selects `timezone`. It goes through the
    real `fetchEventPage`, so it covers the query the component tests can't see.
  - `tests/tournament-schedule.test.tsx` → "TL-009": your New York example on a Los Angeles calendar. The
    label reads "Fri, Dec 11 – Sun, Dec 13" on the Fri–Sun cells, and nothing is on Thu Dec 10.
  - Both failed before the fix.
  - The projection runs against the local database.

**Follow-up verification (2026-10-05):** Source review confirms timezone is present in both the actual projection and its row type. Independent execution using that projection preserves the New York Dec 11–13 label and day keys on a Los Angeles calendar. The projection and cross-zone component regressions pass in CI.

### TL-010 — Name a tournament where its visible month segment begins

**Priority / status:** P2 / Resolved.
**Source:** [schedule-calendar.tsx, lines 427–439](https://github.com/jaredhagemann/lista/blob/6a10d65636eb04a82beb3d120e8d123d5b0b350b/apps/web/src/components/calendar/schedule-calendar.tsx#L427-L439).

A segment is named only on the tournament's actual first day or a Sunday. The calendar renders only
the selected month's days, leaving earlier days as empty cells. If a tournament began in the previous
month and ends before the first Sunday, none of its visible segments has text.

**Reproduction / evidence:** a Nov 30–Dec 3, 2026 tournament in the December calendar has segments on
Tuesday Dec 1 through Thursday Dec 3. All three evaluate `first || weekStart` to false. The event is
fetched correctly by the new overlap query but appears only as an unnamed colored bar unless hovered.

**Requested change:** label the first visible segment (including day 1) as well as new week rows. Add a
month-boundary component test where the new month begins midweek and the tournament ends before Sunday.

**Resolution and verification:** Resolved on 2026-10-05 at `f7f3e62cf`. Fixed in `c5ca6d6f5` (PR #116).
- **The fix:** a segment is named on the tournament's first day, at each week start, **and on day 1 of the
  month shown**. A tournament that began last month is named where its visible run begins.
- **Implementation verification:** `tests/tournament-schedule.test.tsx` → "TL-010", using your example: a
  Nov 30 – Dec 3 tournament in December, which opens on a Tuesday. It's named on Dec 1 and not again on
  Dec 2 or 3. This failed before the fix.

**Follow-up verification (2026-10-05):** Independent execution of the current label predicate confirms that day 1 is named even when neither the tournament start nor a Sunday; subsequent week starts remain named. The Nov 30–Dec 3 component regression passes in CI.

### TL-011 — Show each game's result independently of its score

**Priority / status:** P2 / Resolved.
**Source:** [event-detail.tsx, lines 1050–1056](https://github.com/jaredhagemann/lista/blob/6a10d65636eb04a82beb3d120e8d123d5b0b350b/apps/web/src/components/calendar/event-detail.tsx#L1050-L1056).

The tournament's game list renders only `gameTitle`, round, and date/time. `gameTitle` does not read
`game_result`; it can append two numeric scores but never Win/Loss/Tie. A supported result-only entry
(e.g. a win with both scores blank) contributes to the tournament record yet appears indistinguishable
from an unscored game in its list. The spec and PR description explicitly promise each game's result.

**Reproduction / evidence:** a linked game with opponent Rivals, `game_result='win'`, and null scores
renders only the team/opponent title and its round/time. Changing the result to loss or tie leaves the
row unchanged. The new test called “round and result” asserts numeric scores only.

**Requested change:** render the result separately from the optional score. Cover result-only games,
scored games, and games with neither a result nor score.

**Resolution and verification:** Resolved on 2026-10-05 at `f7f3e62cf`. Fixed in `c5ca6d6f5` (PR #116).
- **The fix:** each game row shows its result as its own Win, Loss or Tie badge, beside the title. The score
  stays in the title when both sides are entered.
- **Implementation verification:** `tests/tournament-event-page.test.tsx` → "TL-011" covers:
  - result-only games (Win, Loss and Tie, each with blank scores)
  - a scored game, showing its result and its score
  - a game with neither, showing no result

  The first two failed before the fix.

**Follow-up verification (2026-10-05):** Source review confirms Win/Loss/Tie renders independently of score fields. CI passes all three regression cases: result-only games, a scored game with its result, and an unanswered result with no badge.

## Part 2b — web management findings

Reviewed PR #117 at `23bd5d3786c1fc77e5fb14e0041ac7beea3f1548`, based on merged #116
(`410df3a0a`). These findings concern the new management forms; the explicitly deferred notice
renderer is recorded as a release dependency rather than a new implementation finding.

### TL-012 — Reject games that end at or before their start

**Priority / status:** P2 / Resolved.
**Source:** [tournament-form.ts, lines 90–102](https://github.com/jaredhagemann/lista/blob/23bd5d3786c1fc77e5fb14e0041ac7beea3f1548/apps/web/src/lib/events/tournament-form.ts#L90-L102), shared by tournament creation and Add a game.

Both game inputs are required, but neither the form nor its shared payload helper validates ordering.
The database also has no positive-duration constraint. Entering a 10:00 start and 09:00 end succeeds,
leaving an event that ends before it starts. Overlap queries then treat it as finished before kickoff,
and the resulting schedule/notification times are impossible. Equal times are also unguarded.

**Reproduction / evidence:** executed the actual create-form handler with mocked React state and a
recording database client. It sent a game from `2026-12-11T10:00:00Z` to `2026-12-11T09:00:00Z`.
Submitted that payload to local `create_tournament` under an authenticated coach in a rollback-only
transaction: the game was inserted, with `end_time > start_time` false. Database check constraints
were also inspected. Browser input validation does not compare these two fields.

**Requested change:** validate converted instants before creating any location/event, reject an end at
or before start, show a useful error on the offending game, and cover both create-with-games and Add a
game. Prefer an appropriate database invariant as well if enforcing this across writers.

**Regression coverage:** reversed and equal ranges must create no tournament/game; a valid range must
still succeed. Include a game crossing midnight to ensure valid multi-day ranges remain allowed.

**Resolution and verification:** Resolved in the 2026-10-06 follow-up at `a3baa09c6`. Fixed in `a0642c8dd` (PR #117).
- **The fix:**
  - `gameTimesError` in `tournament-form.ts` refuses an end at or before the start, or a missing time.
  - The create form checks every game first and shows the error on that game. Nothing is written when one
    fails, not even a new location, and the database isn't called. Add a game checks the same way before
    its insert.
  - **Database invariant:** migration `20261006000000_tournament_game_times.sql` adds a trigger refusing
    `INVALID_GAME_TIMES` for any tournament game, on insert or on a change to its times or tournament. That
    covers `create_tournament` (the whole call rolls back) and plain writes.
  - **Scope decision:** the trigger covers tournament games only, not every event. A table-wide check would
    also apply to any existing standalone event with such times, making its next update fail (a cancel, a
    score). Those events predate tournaments and this review.
- **Implementation verification:**
  - `tests/tournament-form.test.ts` → `gameTimesError`: reversed, equal and missing times refused, and a
    game past midnight accepted.
  - `tests/tournament-manage.test.tsx` → "TL-012": create with a reversed range, with an equal range, and
    with a new location (nothing written); Add a game reversed (no insert, no notice); a game past midnight
    still saves.
  - `tests/rls/tournaments-manage.test.ts` → "TL-012": `create_tournament` with a reversed or equal game
    saves no tournament, game or job; a plain insert, and a move to an end equal to its start, are refused;
    a game across local midnight saves.
  - All of them failed before the fix, except the past-midnight cases, which guard the valid path.

**Independent follow-up verification:** Independently executed the actual create handler with reversed and equal times and a new location selected: no database calls occurred. Valid overnight creation still reached the RPC. Authenticated local SQL probes confirmed reversed/equal create_tournament calls leave no events or notification jobs, direct invalid inserts and updates fail, and a valid overnight game succeeds. Fixtures were rolled back. CI also passes Add a game validation coverage.

### TL-013 — Apply the selected location to games created with the tournament

**Priority / status:** P2 / Resolved.
**Source:** [tournament-create-form.ts, lines 88–93](https://github.com/jaredhagemann/lista/blob/23bd5d3786c1fc77e5fb14e0041ac7beea3f1548/apps/web/src/components/tournaments/tournament-create-form.tsx#L88-L93).

The selected location is sent only as `p_location_id` for the tournament. Every entry in `p_games`
omits `location_id`, and `create_tournament` uses each game's JSON location without falling back to
the parent's. The creation form offers no separate game location, so every initial game has no venue
on its own page, schedule row or notification. This differs from Add a game, which explicitly copies
the tournament's location.

**Reproduction / evidence:** chose a non-null location and one game through the actual create-form
handler with a recording client. The resulting parent argument carried the location, while its game
payload had none. A local authenticated SQL reproduction confirmed `has_location=true` on the
tournament and `false` on the game; that transaction was rolled back.

**Requested change:** carry the resolved tournament location into initial game payloads, matching Add a
game, or explicitly provide per-game venue choices with a sensible default. Later tournament venue
changes need not silently move existing games.

**Regression coverage:** test existing and newly created tournament locations with initial games,
verify persisted child locations as well as parent location, and keep the no-location case working.

**Resolution and verification:** Resolved in the 2026-10-06 follow-up at `a3baa09c6`. Fixed in `a0642c8dd` (PR #117).
- **The fix:** `tournamentGameFields` and `tournamentGamesPayload` take a location. The create form passes
  the resolved tournament location, existing or new, so every initial game carries it, as Add a game
  already did. Later venue changes to the tournament don't move existing games.
- **Implementation verification:**
  - `tests/tournament-manage.test.tsx` → "TL-013": an existing location reaches the tournament and both
    games. A new location is inserted once, and its id reaches the tournament and the game.
  - The no-location case sends `location_id: null` per game (the existing create test, and the helper test).
  - `tests/rls/tournaments-manage.test.ts` → "TL-013": games created with a location are persisted at it
    alongside the tournament, and with no location neither has one.
  - The form tests failed before the fix. The database tests pass either way: `create_tournament` already
    stored each game's own `location_id`, and the defect was the form leaving it out.

**Independent follow-up verification:** Independently executed the actual create handler for existing, new and absent locations. Parent and game payloads carried the same location; the new location was inserted once, and the absent case stayed null. An authenticated local SQL probe confirmed the child venue persisted. Fixtures were rolled back.

### TL-014 — Keep placement-only edits silent

**Priority / status:** P3 / Resolved.
**Source:** [tournament-edit-form.ts, lines 120–124](https://github.com/jaredhagemann/lista/blob/23bd5d3786c1fc77e5fb14e0041ac7beea3f1548/apps/web/src/components/tournaments/tournament-edit-form.tsx#L120-L124).

The form and PR describe placement changes as silent and the Notify switch as sending name/notes
changes. However, the manual enqueue condition checks only that scheduling did not change. Changing
only placement and enabling Notify queues an `updated` notice; enabling it and saving unchanged fields
also queues one. The default-off case is correct, which makes this a lower-priority conditional issue.

**Reproduction / evidence:** executed the real edit component's handler with mocked React state,
changing only placement rank from null to 2 and switching Notify on. The recording client received the
placement update followed by `enqueue_event_notification(cup, updated)`.

**Requested change:** require an actual title/notes change for the optional enqueue path. Keep automatic
scheduling notices unchanged and keep placement-only/no-op saves silent.

**Regression coverage:** placement-only and unchanged saves with Notify on enqueue nothing; a name or
notes change with Notify on still queues an update.

**Resolution and verification:** Resolved in the 2026-10-06 follow-up at `a3baa09c6`. Fixed in `a0642c8dd` (PR #117).
- **The fix:** the optional notice needs Notify on and an actual name or notes change, on an upcoming tournament
  that isn't cancelled. Notices for new days or a new location are unchanged, since the database queues
  them. The send ping follows the same condition.
- **Implementation verification:** `tests/tournament-manage.test.tsx` → "TL-014":
  - placement only, with Notify on, queues nothing
  - an unchanged save, with Notify on, queues nothing
  - a name change, and a notes change, with Notify on, each queue one `updated`

  The first two failed before the fix.

**Independent follow-up verification:** Independently executed the actual edit handler with Notify enabled: placement-only and unchanged saves produced zero enqueue calls; title and notes changes each produced exactly one. No outbound notices were sent.

## Part 2c — tournament notification findings

### TL-015 — Handle tournament game read errors before sending reminders

**Priority / status:** P2 / Resolved.
**Source:** [reminder cron, lines 113–119](https://github.com/jaredhagemann/lista/blob/19e3bca5e16277e9d05f8102874e8ed67af3ba90/apps/web/src/app/api/cron/reminders/route.ts#L113-L119).

The new child-game query reads only `data` and coalesces null to an empty array. If Supabase returns
an error (for example, a statement timeout), the cron treats the tournament as having no games.
It sends the reminder without the game count or schedule, and its push falls back to the date range.
The endpoint still reports success, hiding the failed read. A later successful daily run will normally
be outside this tournament's pre-start reminder window, so it does not repair the incomplete notice.

**Reproduction and observed result:** ran the actual reminder handler and HTML/plain-text renderers
with mocked database and delivery functions. The initial event query returned one tournament;
the child query returned `{ data: null, error: { code: "57014", message: "statement timeout" } }`.
The handler returned HTTP 200 with `success: true`, one event processed and two notifications sent
(email and push). The rendered email had no schedule. The existing successful-read control lists both games.
No real notification was sent.

**Requested change:** inspect the child-query error before constructing or sending that tournament's
reminder. Surface the failure and provide a retry/defer path; do not treat an unavailable schedule as
an empty one or count the tournament as successfully processed. Preserve legitimate zero-game tournaments.

**Regression coverage:** simulate the child read failing after the initial event query succeeds;
assert that a normal, incomplete reminder is not sent and the failure remains visible/retryable.
Keep successful nonempty and genuinely empty schedule cases covered.

**Resolution and verification:** Resolved. Fixed in `3d2818211` (PR #118); independently verified at `af20d2f66` on 2026-10-06 and on merged main `8793d6abe` on 2026-10-07.
- **The fix:**
  - The cron reads a tournament's games first, before recipients, answers or anything sent.
  - **Retry:** a failed read is tried once more, since a statement timeout is usually brief.
  - **When it still fails:** that tournament's reminder isn't sent, by email or push. It's logged, and listed in
    the response as `failedEvents: [{ eventId, error }]`. `eventsProcessed` excludes it.
  - **The run:** it returns HTTP 500 with `success: false`, so the cron's monitoring sees the failure. Every
    other event's reminder still goes out, and so does the notice sweep.
  - **Zero games:** a tournament with no games is a successful empty read, and is still reminded without a
    schedule.
- **Retry and defer, as built:** the retry is the immediate second read. Reminders have no queue of their own,
  and a later daily run is usually after the tournament has started, so nothing defers it past this run. The
  failure is surfaced rather than replaced with an incomplete reminder. A durable deferral would need a
  reminder queue; that wasn't added here.
- **Implementation verification:** `tests/tournament-notice-wiring.test.ts` → "TL-015":
  - one failed read, then a good one, sends the whole reminder (2 games listed), status 200
  - a read failing twice sends no Surf Cup email or push. A standalone practice in the same run is still
    reminded, and the notice sweep still runs. Status 500, with `failedEvents` naming `t-1` and the error.
  - a tournament with no games is reminded without them, status 200

  The first two failed before the fix. The third passed before it too, and guards the legitimate path.

**Independent verification:** the 2026-10-06 follow-up passed 34 focused tests and TypeScript checking.
The 2026-10-07 merged-code review passed 53 affected tests and TypeScript checking, including the same
retry, persistent-failure, continued-processing and zero-game cases. Notifications were mocked.

### Availability scope decision for the next part

A game email/reminder still loads only the game's direct availability row. If a person has answered
Available on the tournament and has no game override, its game reminder renders **"No answer yet"**.
Independently reproduced with the real reminder handler and rendered email. Its answer links correctly
target the game, but its displayed current answer does not reflect inheritance.

The initial review asked whether the availability follow-up should also cover email/reminder answer
labels or whether those labels belonged in #118. This is now settled by D19 below; it is follow-up
scope, not a new blocking finding or an accepted permanent discrepancy. Include both tournament
fallback and explicit game override cases.

**Decided 2026-10-07 (spec D19):** yes. A game's email and reminder show the person's answer for the game,
else their tournament answer. This is built in the effective-availability part after 2c, not in #118.

## Review history

### 2026-10-01 — Specification, PR #111

[PR #111](https://github.com/jaredhagemann/lista/pull/111) was reviewed at `af637d357` and re-reviewed at
`85ec2b4af`. The original design concerns were multi-day query behavior, legacy mobile answer semantics,
tournament notification batching, historical league classification, and recurrence interactions.

The revised spec addresses those concerns and records D13–D18, including cancellation/restoration,
all-day dates, bulk-answer rules, league lifecycle, and the release scope. D14 explicitly accepts the
1.0.12 inherited-answer display discrepancy during rollout; that is an accepted compatibility risk.

The follow-up clarification about deleted notification destinations and RSVP buttons is present in the
current spec's action table. The ongoing implementation reviews should preserve those decisions rather
than reopen them implicitly. The source code review below is separate from accepting the design.

### 2026-10-01 — Part 1 database, PR #114

- **Revision:** `18b0da0a67b7d4ebaefeca0a2a179f26c7988c63`, based on `fd87847dcb30672f6c6b96d6ae18b8e1b5c6d6c1`.
- **Scope:** migration, new RLS tests, generated type additions, fixture updates, and mobile compatibility notes.
- **Outcome:** opened TL-001 through TL-006, all P2. No fixes or production behavior were verified.
- **CI observed:** unit, web, mobile, RLS integration, and staging migration checks were green at this revision.
- **Local verification:** six focused SQL reproductions against the local Supabase database. Single-session
  fixtures were rolled back; the two-session concurrency fixture was explicitly removed afterward.
- **Local test limitation:** Vitest did not start because the local dependency tree was missing `esbuild`.
  The test suite was not rerun successfully locally; passing CI and the direct SQL probes are separate evidence.
- **Other checks:** `git diff --check` passed. The review did not change application code or publish GitHub comments.

### 2026-10-01 — Part 1 database fixes, PR #114

- **Revision:** `5e00b4d06`, on `18b0da0a6` (the reviewed commit).
- **Scope:** migration `20261001000001_tournaments_review_fixes.sql`, which replaces the trigger,
  `create_tournament`, `delete_tournament`, `cancel_tournament`, `enqueue_tournament_notice` and
  `set_unanswered_availability`, and adds `tournament_game_summaries`. A separate migration, because
  staging already had `20261001000000`. Also:
  - the new test file `tests/rls/tournaments-review.test.ts`
  - shared fixtures moved to `tests/rls/tournament-fixtures.ts`
  - the generated types
  - the spec, recording each rule and the `affected_games` contract
- **Status changes:** TL-001 through TL-006, Open → Implemented — awaiting review. None is marked resolved:
  that's for the next review round.
- **Local verification:**
  - With the original migration only, the new file's 17 tests ran with 11 failing. Each failure reproduced
    its finding. The 6 legitimate-case tests passed.
  - With the fix migration, all 40 tournament tests pass: the original 23 and the 17 new ones.
  - The full RLS suite passes after `supabase db reset` with the pinned CLI (2.78.1): 47 files, 601 tests.
  - Web `tsc --noEmit` is clean.
- **TL-001 method:** two concurrent `psql` sessions in the database container. One holds its transaction
  open for 2 seconds. The tests assert that the two writes can't both commit, and that no invalid link
  remains, so they hold whichever session's write lands first.

### 2026-10-01 — Independent follow-up review, PR #114

- **Revision:** `82005445befca94d176147a6b5a1c1a0a5960997`; implementation changes in
  `5e00b4d06c0a463492fdccc8e189666dd12dccf5`.
- **Scope:** the follow-up migration, the 17 new regression tests and shared fixtures, generated types,
  spec changes, and verification of TL-001 through TL-006.
- **Status changes:** TL-001 through TL-006 → Resolved. Opened TL-007 (P2) for the new ID-only
  cancellation update acting on a game moved concurrently to another tournament.
- **Independent local verification:** with migration `20261001000001` applied, direct SQL probes verified
  both reverse-series refusals, the bulk-answer failure and legitimate source case, both deletion-notice
  cases, retained-game snapshots surviving later deletion, and historical/future creation notices.
  Two-session probes verified TL-001 in both type-change orders and the team-change case. Two further
  concurrency cases reproduced each cancellation choice in TL-007. Writes ran as `authenticated` with a
  fixture coach identity; setup and cleanup used the local database administrator.
- **Cleanup:** single-session probes rolled back. Uniquely identified concurrency fixtures were removed
  after each case. No production or staging data was modified by this review.
- **CI observed:** unit, web, mobile, RLS integration, and staging migration checks were green at this head.
- **Local test limitation:** invoking Vitest for the two tournament test files still failed before test
  execution because the local dependency tree is missing `esbuild`. The author's full-suite results above
  are distinct from this review's independently executed SQL checks.
- **Other checks:** `git diff --check` passed. This review updated only the review log; no application fixes
  or GitHub comments were made.

### 2026-10-02 — TL-007 fix, after #114 merged

- **Revision:** `b80893172`, on `main` at `46479e2b4` (the #114 merge). The follow-up review round above was
  committed as written in `45e420e01`.
- **Scope:** migration `20261002000000_tournaments_lock_games.sql`, which replaces `cancel_tournament` and
  `delete_tournament`, and four TL-007 tests.
- **Status changes:** TL-007, Open → Implemented — awaiting review.
- **Also changed:** `delete_tournament` had the same unlocked read before its change, so it gets the same fix
  under TL-007 rather than a new finding.
- **Local verification:**
  - Against `main` (without the fix), the three overlap tests failed and the ordinary case passed.
  - With the fix, all 44 tournament tests pass, and the full RLS suite passes with the pinned CLI (2.78.1):
    47 files, 605 tests.

### 2026-10-02 — PR #115 locking fix and PR #116 web display

- **Revisions:** PR #115 `99bab47cda875b96dd004ec31506f04c7f52a4a0`; PR #116
  `6a10d65636eb04a82beb3d120e8d123d5b0b350b`. Both based on main `46479e2b447b4b8771595c170701397d6e328359`.
- **Outcome:** TL-007 → Resolved; no new findings in #115. Opened TL-008 through TL-011 in #116.
- **Independent checks:** four local SQL probes (three concurrent move/action cases and ordinary
  cancellation), plus direct execution of date helpers and the calendar label predicate. Source review
  covered the changed queries, pages, components, tests and intended part boundaries.
- **PR #115 CI:** web, unit, mobile, RLS and staging migration checks passed.
- **PR #116 CI observed:** new tournament tests passed; the web job had 1,317 passing tests and one
  failure in unchanged `leaderboard-pin.test.tsx` (“removes the pinned copy once the self row scrolls back
  into view”, line 160). This is a check to resolve/rerun, not a demonstrated tournament regression.
  Unit, mobile and Vercel passed; RLS was still running when checked.
- **Staging dependency:** #116's staging migration job failed because remote version `20261002000000`
  from #115 is absent from its branch. Integrate #115's migration before retrying #116 against shared
  staging. No migration history repair or remote write was performed during review.
- **Limitations:** the full test suite was not rerun locally; the local Vitest dependency tree was
  missing `esbuild`. CI, independent probes and source inspection are separate evidence.
- **Review log:** carried forward the latest history from #115 before adding this round, because #116
  branched from main before that log update. Application code was not changed and no GitHub comments
  were published.

### 2026-10-03 — TL-008 to TL-011 fixes, PR #116

- **Revision:** `c5ca6d6f5`, on `6a10d6563` (the reviewed head). The review round above was committed as
  written in `b3ed5cd58`.
- **Scope:** `event-detail.tsx` (TL-008, TL-011), `schedule-calendar.tsx` and `queries.ts` (TL-009,
  TL-010), and tests in `tournament-event-page`, `tournament-schedule`, `event-range` and
  `event-projection-types`.
- **Status changes:** TL-008 through TL-011, Open → Implemented — awaiting review.
- **Decision recorded under TL-009:** a tournament's calendar cells follow its own dates in its own zone.
  It's all-day, so Fri–Sun sits on Fri–Sun on any team's calendar.
- **Local verification:**
  - Before the fixes, the six new tests failed, and each failure reproduced its finding.
  - With the fixes, web passes 1,326 of 1,326, and `tsc --noEmit` is clean.
  - The calendar projection, now with `timezone`, runs against the local database.
- **Still open from the review notes:**
  - **Staging:** #116's staging migration needs #115's `20261002000000` on its branch. That will be done by
    updating #116 from `main` once #115 merges.
  - **Flaky test:** the web job's `leaderboard-pin.test.tsx` failure is BUG-030, the known flaky test filed
    on 2026-09-30, and isn't a tournament regression.

### 2026-10-05 — Follow-up verification of TL-008 through TL-011, PR #116

- **Revision:** `f7f3e62cfcc39b6768ec303b98886c0f2e24721e`; implementation fix
  `c5ca6d6f5acf780663309fdbffe305fadc770adf`, committed 2026-10-03.
- **Outcome:** TL-008 through TL-011 → Resolved. No new actionable findings in this focused review.
- **Verification:** reviewed the implementation and regression tests, independently executed the
  date helper with the real calendar projection's shape and the updated month-label predicate, and
  inspected CI at the reviewed head. The four focused test files passed in CI: tournament-event-page
  (13), tournament-schedule (10), event-range (9), and event-projection-types (3).
- **CI:** all 98 web test files passed; unit, mobile, RLS integration and Vercel checks also passed.
  The earlier leaderboard test failure is not present in this run.
- **Local limitation:** attempted the four focused Vitest files; startup still fails because the local
  dependency tree lacks esbuild. No successful local component-test run is claimed.
- **Remaining integration check:** staging still rejects remote migration version `20261002000000`
  because #116 lacks #115's migration. Both PRs remain open. Merge #115, update #116 from main, and rerun
  its staging check. This is separate from the four resolved display findings.
- **Changes made by this review:** review log only; no application changes, commits, pushes or PR comments.

### 2026-10-06 — Part 2b management, PR #117

- **Revision:** `23bd5d3786c1fc77e5fb14e0041ac7beea3f1548`, based on `410df3a0a`.
- **Scope:** all changed form helpers, tournament components, page integration and new regression tests;
  database functions and notification behavior were traced where called by the new code.
- **Outcome:** opened TL-012 and TL-013 (P2), TL-014 (P3). Prior findings TL-001–TL-011 remain resolved.
- **Completed since the last review:** #115 and #116 merged, including the reviewed fixes. Their staging
  migration dependency is resolved; #117's staging migration check is green.
- **CI:** web (100 test files), unit, mobile, RLS and Vercel passed. The new RLS management file passed all
  six tests. CI evidence belongs to this exact PR head; the new edge cases above are absent from those tests.
- **Independent verification:** executed actual create/edit handlers through a lightweight TypeScript
  harness with mocked React state, UI imports and recording Supabase calls. This is handler-level
  verification, not a browser rendering test. Checked location and invalid-time persistence with an
  authenticated local PostgreSQL transaction, rolled back afterward.
- **Local limitation:** attempted targeted Vitest for tournament-form, tournament-manage and
  tournament-event-page; startup still fails on missing esbuild. No successful local suite run claimed.
- **Release scope:** part 2c notices are explicitly required by the PR before release. Effective
  availability in the UI, mobile tournament support and leagues are not completed by this PR.
- **Review changes:** updated this log only; no application changes, commits, pushes, remote database
  writes or published GitHub comments. `git diff --check` passed.

### 2026-10-06 — TL-012 to TL-014 fixes, PR #117

- **Revision:** `a0642c8dd`, on `23bd5d378` (the reviewed head). The review round above was committed as
  written in `a7f469681`.
- **Scope:**
  - `tournament-form.ts` (TL-012, TL-013)
  - `tournament-game-rows.tsx`, `tournament-create-form.tsx` and `tournament-dialogs.tsx` (TL-012, TL-013)
  - `tournament-edit-form.tsx` (TL-014)
  - migration `20261006000000_tournament_game_times.sql` (TL-012)
  - tests in `tournament-form`, `tournament-manage` and `tests/rls/tournaments-manage`
- **Status changes:** TL-012 through TL-014, Open → Implemented — awaiting review.
- **Decision recorded under TL-012:** the database invariant covers tournament games only, so existing
  standalone events keep working on their next update.
- **Local verification:**
  - Before the fixes, 14 web tests and 3 RLS tests failed, and each failure reproduced its finding.
  - With the fixes:
    - web passes 1,382 of 1,382, and `tsc --noEmit` and eslint are clean
    - after a local `db reset`, the tournament RLS files and `event-queries` pass, 81 of 81
- **Release scope:** unchanged. Part 2c notices still have to ship with or before #117.

### 2026-10-06 — Independent follow-up on TL-012 through TL-014, PR #117

- **Revision:** `a3baa09c670db829cdf11486c6c6cac74340764e`; implementation fix `a0642c8dd`.
- **Outcome:** TL-012, TL-013 and TL-014 → Resolved. No new actionable findings in this focused review.
- **Independent verification:** ten handler-level probes using actual TypeScript components with mocked
  React state and a recording Supabase client: reversed/equal times, overnight games, three location
  choices, placement/no-op silence, and title/notes notification controls. These are not browser tests.
- **Database verification:** inspected the installed trigger, then used authenticated coach claims in a
  rollback-only local transaction to verify atomic rejection of invalid creates, direct insert/update
  protection, valid overnight creation and child location persistence. All passed; no fixtures retained.
- **CI:** all checks passed, including web, unit, mobile, RLS integration, staging migration and Vercel.
  Focused files passed: tournament-form (17 tests), tournament-manage (39), RLS tournaments-manage (12).
  The web run passed all 100 test files.
- **Local limitation:** targeted Vitest startup still fails because esbuild is missing. Passing CI and
  independent handler/SQL probes are separate evidence; no successful local Vitest run is claimed.
- **Release dependency:** unchanged: tournament notices in part 2c must ship with or before #117.
- **Review changes:** this log only; no application changes, commits, pushes or published PR comments.

### 2026-10-06 — Part 2c tournament notices, PR #118

- **Revision:** `19e3bca5e16277e9d05f8102874e8ed67af3ba90`; base #117 at `2d81379fcd02f54529b964eec3ea6e7b9ce9fc98`.
- **Scope:** all 11 changed files; tournament email and push routing, snapshots and per-action links,
  answer eligibility, affected-game lists, game tournament/round labels, reminder queries and new tests.
- **Outcome:** TL-015 opened (P2); TL-001–TL-014 remain resolved. Availability answer labels recorded
  separately as a scope question for the next part.
- **Completed:** a dedicated tournament template using whole-day dates and game schedules; update
  comparisons; cancellation/kept/deleted game summaries; schedule links after deletion; action-appropriate
  answer buttons; tournament context in game emails; tournament reminders with active-game counts.
- **Independent verification:** the full web suite passed locally: 1,405 tests in 102 files, including
  all 23 new tests with actual HTML/plain-text rendering. All three new RLS integration tests passed against localhost Supabase with fixture cleanup. TypeScript
  `tsc --noEmit --incremental false` passed. Two additional probes reproduced TL-015 and the inherited
  answer-label behavior using mocked delivery. Temporary probe tests were removed afterward.
- **CI:** only Vercel deployment/preview checks are present and passing at this head. The test workflow
  targets PRs into main and has not run on this stacked PR. Recheck CI after retargeting/merging its base.
- **Limitations:** no visual inbox/browser QA or real email/push delivery performed. The earlier local
  dependency-access problem was overcome by reusing the installed dependencies with approved access in
  an isolated review worktree; the local test results above were independently executed.
- **Review changes:** this log only in the isolated `pr118-review` worktree; no application changes,
  commits, pushes or published GitHub review comments. `git diff --check` passed.

### 2026-10-06 — TL-015 fix, PR #118

- **Revision:** `3d2818211`, on `8faf4d6e3`. The review round above was committed as written in `8faf4d6e3`,
  copied from the `pr118-review` worktree.
- **Scope:** `app/api/cron/reminders/route.ts` and `tests/tournament-notice-wiring.test.ts`.
- **Status changes:** TL-015, Open → Implemented — awaiting review.
- **Local verification:**
  - Before the fix, two of the three new tests failed, and each failure reproduced the finding.
  - With the fix, web passes 1,408 of 1,408, and `tsc --noEmit` and eslint are clean.
- **The availability scope question:** not decided in this round. It's put to the user, with the recommendation
  that email and reminder answer labels go with the effective-availability part, alongside the web, since they
  need the same `effectiveAnswer` rule.

### 2026-10-06 — Independent follow-up on TL-015, PR #118

- **Revision:** `af20d2f66278e8f98b3ce85e5a3d445c4eb34d0d`; fix `3d2818211`.
- **Outcome:** TL-015 → Resolved; no new actionable findings. This result was originally recorded in
  the isolated `pr118-review` worktree and is carried into the main review log in the next round.
- **Independent verification:** all 34 tests across `tournament-notice-wiring`, `tournament-notice-email`,
  `reminders-cron` and `notifications-cron` passed, plus `tsc --noEmit --incremental false`.
- **Scope:** verified successful retry, persistent failure without sending an incomplete notice,
  continued processing of other events and the notice sweep, and valid zero-game reminders.
- **Limitation:** retries consist of one immediate second read. Persistent failures are reported, not queued.

### 2026-10-07 — Merged-code review before effective availability

- **Revision:** `8793d6abe69009b84886dba017990541784d9470`, matching remote main at review time.
- **Scope:** all changes since reviewed `af20d2f66`, plus integration of PRs #117–#120. The application
  delta is BUG-032 in `worker.ts` and `event-email.tsx`; other additions are its regression tests/ticket
  and the D19 specification decision. The reviewed tournament management, database and TL-015 code
  remains intact.
- **Outcome:** no new actionable findings. TL-001–TL-015 remain resolved. No code-review blocker to
  starting effective availability; D19 explicitly includes game email/reminder answer inheritance.
- **Merge integration:** #118 initially merged to its feature base after #117 had merged. #120 brought
  the notices onto main. #119 then added the standalone deleted-event fix. The final worker keeps
  tournament-specific rendering and URLs, routes deleted standalone notices to the schedule, and
  keeps live/cancelled events linked to their detail page. Deleted notices do not acquire answer buttons.
- **Independent local verification:** 53 tests passed in `deleted-event-notice-link` (3),
  `tournament-notice-wiring` (11), `tournament-notice-email` (15), `email-wiring` (16),
  `reminders-cron` (4), and `notifications-cron` (4). These exercise the real renderers/worker with
  mocked delivery. `tsc --noEmit --incremental false` passed.
- **CI at the exact main revision:** [Tests](https://github.com/jaredhagemann/lista/actions/runs/37684883034)
  passed web, unit, mobile and RLS integration jobs. The
  [production migration job](https://github.com/jaredhagemann/lista/actions/runs/37684883093) passed;
  staging was skipped for the main push. The earlier stacked-PR CI gap is resolved.
- **Next-part scope:** preserve the existing override/clear/bulk-fill decisions and implement D19
  alongside UI inheritance. A game's own response takes precedence, clearing reveals its tournament
  response, and email buttons continue to write game overrides. The current raw-answer behavior is
  known, planned work, not a regression introduced by these merges.
- **Limitations:** no real outbound email/push or production UI smoke test performed. Full suites
  were verified through CI; local execution was limited to affected tests and TypeScript checking.
- **Review changes:** updated this review log on main only, including the previously unmerged TL-015
  resolution. No application edits, commits, pushes or published GitHub comments. `git diff --check` passed.

Append subsequent review rounds here, including the exact revision and verification for every status change.
