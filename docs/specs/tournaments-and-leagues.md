# Spec — Tournaments and leagues

**Status:** Decided 2026-10-01 (§6, D1–D18), revised the same day after review (§9). Ready to build:
tournaments first, then leagues (D12).
**Requested:** 2026-10-01, by the user. The 1.1.0 mobile release waits for both tournaments and leagues (D12).
**Scope:** database, web and the mobile app.
**Review log:** [Findings, verification, and iteration history](../reviews/2026-10-01-tournaments-and-leagues-review.md).

## 1. What's wanted

**Tournaments**
- A team enters a tournament: usually **several days**, with **several games**.
- The tournament has a **placement** ("1st place", "Finalist", "Gold bracket champions").
- The placement and the tournament's own record belong to **its games only**.
- People need to see the tournament on the schedule as one thing, see its games, and say whether they're coming.

**Leagues**
- Games can be **tagged with a league** ("Fall 2026 Division 3").
- The app then shows the team's **league record** next to its **overall record**.

## 2. Today

- **Event types:** `events.event_type` is one of `practice`, `game` or `other`, enforced by a check constraint
  (`20260101000000_initial_schema.sql`). `set_unanswered_availability` also rejects any other type
  (`20260922000000`, line 48).
- **Game fields live on the event:** `opponent`, `home_away`, `uniform`, `score_for`, `score_against` and
  `game_result`.
- **The record:** wins, losses and ties over every past game with a result (`lib/events/team-record.ts`, on
  both the web and the phone). There's no grouping of games.
- **Series:** a recurring series is a head event with `recurrence_rule`, and children point at it through
  `events.parent_event_id` (BUG-009). The series editor (`lib/events/series-edit.ts`) only changes upcoming
  occurrences, and skips ones individually cancelled or rescheduled.
- **Every query is by start time:**
  - schedule pages are a keyset on `(start_time, id)` (`lib/events/queries.ts`)
  - the dashboard's Upcoming is `start_time >= now`, and so is the app's home screen
  - the reminders cron takes events starting in the next 24 hours
  - none of them looks at `end_time`
- **Notifications** (`20260917000007_notification_jobs.sql`):
  - Creating an event notifies only when the app asks (`enqueue_event_notification`).
  - Cancelling, restoring, deleting, and changes to time, location or arrival are enqueued by a trigger.
    Other edits, and past events, never notify.
  - Jobs are batched per transaction, team and action. A batch keeps its **first** event's snapshot, and
    counts the rest.
  - The worker renders any batch of more than one as a **series** update ("N events in this series have
    changed").
- **Team settings:** `teams.league` and `teams.league_url` are free text, edited and shown on the web only.
  The app doesn't read them.
- **What branches on `event_type`:**
  - on the web: the calendar, schedule list, event page and form, the series editor, the availability matrix,
    the dashboard, the reminders cron, the notification worker and dispatch, the event email, and game titles
  - on the phone: the home, schedule and event screens, and `lib/game-display.ts`

## 3. Modeling tournaments: options

| | A. A tournament is an event | B. A separate `tournaments` table | C. A tag on games only |
| --- | --- | --- | --- |
| **Shape** | A new `event_type = 'tournament'`, spanning its days. Each game points to it through a new `events.tournament_id`. | `tournaments(team_id, name, dates, location, placement…)`, and games point to it through `events.tournament_id`. | `events.tournament_name` text on each game. |
| **On the schedule, calendar, reminders** | Free, once queries understand multi-day events (§4). | Needs new rendering everywhere a schedule is shown. | Only the games show. Nothing ties them together. |
| **"Are you coming?"** | Free: availability on the tournament event. | New availability table, or per game only. | Per game only. |
| **Placement and record** | Columns on the tournament event, and its record from the games pointing to it. | Columns on `tournaments`, and the same record. | Placement has nowhere to live. A record by name works until it's misspelled. |
| **1.0.12 on phones** | Shows the tournament as an event of an unknown type (§7). | Doesn't see tournaments at all, only their games. | Unaffected. |
| **Cost** | Moderate. | Highest. | Lowest, but it doesn't meet the need. |

**Decided: A** (D1).

## 4. Tournaments: design

### Data

- **Event type:** `event_type` allows `'tournament'`. The check constraint changes, and so does
  `set_unanswered_availability`.
- **Tournament fields** (new, nullable, on `events`; only a tournament may set them):
  - `placement_rank int`: 1, 2, 3… Shown as "1st place" when there's no label.
  - `placement_label text`: free text, e.g. "Gold bracket champions" or "Group stage". It wins over the rank.
- **Link from game to tournament:** `tournament_id uuid references events(id)`, nullable, games only.
  - It must point at a tournament on the **same team** (enforced by a trigger).
- **Round:** `round text`, optional on games ("Pool A", "Semifinal"; D7).
- **Standalone only (D18):** a tournament, and every game linked to one, is never part of a recurring series.
  - Each has `recurrence_rule` and `parent_event_id` both null.
  - A trigger refuses to link a series head or child to a tournament, and refuses to make a tournament or a
    tournament game into a series.
  - So deleting or cancelling a tournament's games can never reach a series: no foreign-key failure, and no
    unrelated occurrences.
- **Dates (D13): all-day and inclusive.** A tournament is a range of whole days in its zone
  (`events.timezone`, else the team's).
  - `start_time` is midnight starting its first day. `end_time` is midnight ending its last day, so a
    Friday–Sunday tournament ends at 00:00 Monday, local time.
  - It's shown as dates only: "Fri Oct 11 – Sun Oct 13".
  - Its games have real times. The form warns if a game falls outside the tournament's days, but the
    database doesn't enforce it, because schedules slip.
- **Deleting (D5):**
  - A plain delete of a tournament with games is refused: the foreign key has no cascade, as for a series
    head under BUG-009.
  - "Delete the tournament and its games" is one database function. It deletes the games (and their
    answers), then the tournament, in one transaction, with one notification (see Notifications).
  - **That notification goes out** when anything live is removed: the tournament, or **any** of its games
    that isn't cancelled or over. A cancelled tournament can still have a restored game, and an ended one a
    game moved past its dates (review TL-004).
- **Series (D18), both ways:** an event that still heads a series, with occurrences pointing at it, can't
  become a tournament or join one, even with its own rule cleared (review TL-002).
- **Concurrent edits:** linking a game locks its tournament row, so a game being linked and its tournament
  changing type or team can't both succeed (review TL-001).

### Rules

- **Tournament record:** wins, losses and ties over its games with a result.
- **Overall record:** every game, tournament games included (D3).
- **Placement:** set by a team admin on the tournament, usually at the end. It isn't derived from the games.
- **Titles:** the tournament's own title ("Surf Cup"). Its games keep `gameTitle` ("U10 Girls vs Rivals FC").
  Wherever a game is shown, a line names its tournament ("Surf Cup · Semifinal").

### Multi-day events in queries

A Friday–Sunday tournament mustn't drop off Upcoming on Friday afternoon, or out of November when it started
on October 31. So multi-day events need queries by **overlap**, not by start time.

- **Overlap with a window** (a month, a week, "from now"): `start_time < window end` and
  `end_time > window start`. This applies to every event type: a practice in progress also overlaps "now".
  - **Upcoming** (the dashboard, and the app's home): `end_time > now`. A tournament stays listed until its
    last day ends, marked "Now" while it's underway.
  - **The calendar's month:** overlap with the month, so a tournament crossing a month boundary shows in both.
  - **The schedule list:** the keyset on `(start_time, id)` stays as the order. Its filter for upcoming
    becomes `end_time > now`, so an underway tournament leads the list.
- **No nesting across pages:**
  - In the schedule list, the tournament is one row at its start, showing its dates and game count. Each of
    its games is its own row at its own time, with the "Surf Cup · Semifinal" line.
  - Nothing is grouped under the tournament in the list, so it doesn't matter which page a tournament and its
    games land on.
  - The **tournament page** lists all its games with its own query (`tournament_id = …`). That's where they're
    grouped.
- **The calendar:** a bar across the tournament's days, and each game on its day as today.
- **Indexes:** an index on `(team_id, end_time)` for the overlap filters, plus one on `tournament_id`.
  `20260921000000` already has `(team_id, start_time, id)`.

### Availability (D2: both)

People answer the tournament, and can answer a game to override it ("can't make Sunday's games").
- **Storage:** existing `availability` rows, one per person per event. The tournament's row is the main
  answer, and a game's own row is an override. No new table.
- **A game's answer:** its own row if there is one, else the tournament's, else none. The rule
  `effectiveAnswer(gameRow, tournamentRow)` is shared by the web and the phone.
- **Where answers are shown:**
  - **The tournament's response list:** the tournament answers.
  - **A game's response list:** answers for that game. Inherited ones are marked "from the tournament".
  - **The coach's availability grid:** a column for the tournament, and one per game showing the resulting
    answer, with overrides marked.
- **Clearing a game's answer** goes back to the tournament's answer. It doesn't mean "no answer".
- **Bulk "Set my unanswered events to…"** (`set_unanswered_availability`, BUG-014; D16):
  - When a tournament and its games are all unanswered, it answers **only the tournament**. The games then
    follow it, including if the tournament answer changes later. Answering the games too would turn them into
    overrides that stop following.
  - A game whose tournament is answered already has an answer, and is skipped.
  - A game only stands for its tournament while the game itself is unanswered. An answered game in the
    window doesn't pull in its tournament, whose other games may lie outside the window (review TL-003). An
    unanswered game in the window still reaches a tournament that's already underway.
  - A `'tournament'` type filter answers tournaments.
  - **The `'game'` filter (D16b):** it covers **standalone games only**. Tournament games
    are answered through their tournament, under the `'tournament'` filter or with no filter. A "games" fill
    never silently answers a weekend-long tournament, and never creates overrides.
- **Reminders and unanswered counts:** a game counts as unanswered only if neither it nor its tournament has
  an answer.
- **1.0.12, an accepted difference (D14):** 1.0.12 reads raw rows, so on a tournament game it shows that game's
  own answer, or "no response". It never shows the inherited one.
  - **Example:** someone answers Available for the tournament, then Unavailable for one game. If they clear the
    game in 1.0.12, it shows "no response", but coaches see Available again, inherited from the tournament.
  - **Decided:** accept this for the rollout, given the small user base. The release notes say so. It ends when
    they update to 1.1.0.

### Cancelling and rescheduling (D15)

Today, cancelling or restoring changes only the selected event. A tournament needs its own actions, each
one database function:
- **Cancel a tournament:** the coach chooses:
  - **"Cancel the tournament and its remaining games"**: its upcoming games are cancelled too. Past games
    keep their results.
  - **"Cancel the tournament only, and keep its games as standalone games"**: its upcoming games are
    unlinked (`tournament_id` cleared) and stay on the schedule. Their own answers stay; inherited answers
    don't move to them.
- **Restore a tournament:** restores the tournament only. Games cancelled with it stay cancelled, and each is
  restored on its own.
- **Reminders** follow `is_cancelled`, as today: cancelled games get none.
- **Rescheduling a tournament's dates** doesn't move its games. The form lists any games now outside the
  dates, so the coach can move them.
- **Cancelling or rescheduling a single game** works as for any game, and its notice names the tournament.

### Notifications

A tournament-wide action must send **one notice that reads as a tournament**, never as a series.

- **Tournament jobs:** a tournament-wide function (create, cancel with or without games, restore, delete with
  games) enqueues **one** job itself.
  - The snapshot is the tournament's, plus `tournament`, a summary of what happened to its games ("and its
    4 remaining games"):
    - `games`: how many it has, or had
    - `affected`: how many this action changed
    - `games_action`: `created`, `cancelled`, `kept` or `deleted`
    - `affected_games`: each changed game's id, title, times, zone, opponent, home/away, round and
      cancellation, captured **before** the action changed them. Unlinked or deleted games can't be found from
      the tournament afterwards (review TL-005).
  - Per-row trigger jobs from the games are suppressed for that transaction, through a transaction-local
    setting the trigger checks. So the batch can't keep a game's snapshot first.
- **The worker:** a job whose snapshot is a tournament uses a **tournament template**, whatever its count. It
  never uses the series template.
- **Creating:** a team admin saves the tournament and its games in one call (`create_tournament`), with
  "notify the team" checked by default, as for any new event. One notice: "Surf Cup · Fri Oct 11 – Sun Oct 13
  · 5 games", and the games listed. A tournament that's already over is saved without a notice, as no event
  notifies once it has ended. That lets a coach enter past tournaments (review TL-006).
- **Links and answer buttons depend on the action.** This is today's rule for single events
  (`asksForAnswers` in `lib/notifications/worker.ts` offers answers only for created, updated and restored;
  links fall back to `/dashboard/schedule`), applied to tournaments:

  | Tournament notice | Links to | Available / Maybe / Unavailable |
  | --- | --- | --- |
  | Created, updated, restored | the tournament page | yes, answering the **tournament** |
  | Cancelled (with or without its games) | the tournament page, which still exists, marked cancelled | no |
  | Deleted (with its games) | the **schedule** (`/dashboard/schedule`), since the tournament is gone | no |

  Games unlinked by "cancel the tournament only" are listed in the cancellation notice as staying on the
  schedule. They get no buttons there; each game's own page has its picker.
- **Single games** keep today's notices ("Semifinal moved to 3:00 PM"), with "Part of Surf Cup", and the same
  rule. A created, updated or restored game's buttons answer that game, as an override. A cancelled or
  deleted game's notice has none.
- **Reminders (D6):** a reminder for every event, the tournament and each game, as for any event.
  - The tournament's goes with the reminders run before its start date. Its `start_time` is midnight that
    day, inside the next-24-hours window.
  - It reads as a tournament: "Surf Cup starts tomorrow · 5 games".

### Web

- **Create a tournament:** name, dates, location and notes, then its games: a time, opponent, home/away,
  uniform, round, and league (D4). Saved in one call, with one notice.
- **Tournament page:**
  - dates, location, placement, and its record
  - its games in order, each with its round, score and result
  - "Are you coming?" for the tournament, and each game's optional override
  - the cancel, restore and delete choices (D5, D15)
- **Schedule and calendar:** as in "Multi-day events in queries".
- **Game page:** "Part of Surf Cup", linking to the tournament.
- **Dashboard:**
  - Upcoming shows the tournament while it's upcoming or underway.
  - The Record card stays overall, with league rows (D9). After a tournament with a placement, the last
    result is "Surf Cup · 2nd place · 3–1–0" (D8).
- **Emails:** as in "Notifications".

### Mobile app

Display and answering only. Creating events stays on the web (D11).
- **Home and schedule:** the tournament as one card with its dates (and "Now" while it's underway), and its
  games as their own rows with "Surf Cup · Semifinal". Queries by overlap, as on the web.
- **Tournament screen:** dates, location, placement and record, its games, and the picker for the tournament.
- **Game screen:** "Part of Surf Cup", and its own picker for an override. It shows the inherited answer until
  one is set.
- **Multi-day dates:** "Fri Oct 11 – Sun Oct 13" instead of "Ends 5:00 PM".

## 5. Leagues

### Options

| | A. Free-text tag on games | B. Team leagues | C. Club leagues |
| --- | --- | --- | --- |
| **Shape** | `events.league text` | `leagues(team_id, name, season)`, and games carry `league_id` | `leagues(organization_id, …)`, plus `team_leagues` |
| **Record by league** | Grouped by text. A typo splits a record. | Exact. | Exact, and shared across a club's teams. |
| **Fits** | A quick start. | Any team, free or club. | Clubs. Later, standings across teams. |

**Decided: B, team leagues** (D10). It can grow into C later.

### Design

- **One league per season (D17):** `leagues(id, team_id, name, season text not null, archived_at null)`.
  - "Fall 2026 Division 3" is one league. Next fall's is another.
  - A record is always one season's.
- **Archiving** hides a league from pickers and from the Record card's rows. It never removes its games' tags,
  so its record stays, for a season view later (roadmap: Stats & Season Records).
- **Games:** `events.league_id`, nullable, games only, and the league must be the event's own team's (a
  trigger).
- **Tagging games:**
  - **New games:** the game form, and the new-series form, have a League picker: the team's active leagues,
    plus "Add league…".
  - **Existing games, past ones included:** a separate **"League games"** action in the league's settings. It
    lists the team's games for a date range, with checkboxes, and sets or clears `league_id` on the chosen
    ones.
    - It changes classification only, never the schedule. So it's silent: the notification trigger ignores
      the column, and past games never notify.
    - It includes played games, so a league added halfway through a season gets its earlier results.
  - **The series editor doesn't set leagues.** It only touches upcoming occurrences and skips exceptions, so
    it would leave played games out of the league's record. Feedback, §9.
- **Records:** overall (every game), plus one per active league: "Fall 2026 Division 3 · 6–2–1" (D9).
- **Schedule:** a small league tag on league games.
- **Tournaments and leagues are independent** (D4): a game can carry either, or both.
- **The old team fields (D17):** `teams.league` and `teams.league_url` are the team's free-text league
  and its website, on the web's team settings.
  - **Decided: leave them for now**, labeled "League (shown on your team page)", and don't use them for
    records.
  - Later, either retire them or turn the website into a field on `leagues`. That's a separate change: data
    exists in them, and 1.0.12 doesn't read them, so there's no rush.

## 6. Decisions

| # | Question | Decision (2026-10-01) |
| --- | --- | --- |
| D1 | How is a tournament modeled? | A `tournament` event type, with games linked by `events.tournament_id` (§3) |
| D2 | Where do people answer? | **Both:** the tournament, and optionally a game. The game's own answer wins (§4, Availability) |
| D3 | Tournament games in the overall record? | Yes |
| D4 | A game in a league and a tournament? | Yes, independently. Nothing is inherited |
| D5 | Deleting a tournament with games | A plain delete is refused. "Delete the tournament and its games" is one function and one notice |
| D6 | Reminders | **A reminder for every event:** the tournament (before its start date) and each game. This went against the recommendation of one per tournament |
| D7 | A round on games | Yes, optional `events.round` |
| D8 | The dashboard after a tournament | Its placement shows as the last result until a newer game |
| D9 | Leagues on the Record card | A row per active league under the overall record |
| D10 | League model | Team leagues (§5) |
| D11 | The app before 1.1.0 | Display and answering for **both tournaments and leagues**. Creating them stays on the web |
| D12 | Order, and the release | Tournaments first (database, web, app), then leagues (database, web, app). **The `ios-v1.1.0` tag waits until both are done** |
| D13 | Tournament dates | All-day and inclusive, in the tournament's zone. Its reminder goes before its start date |
| D14 | 1.0.12 shows a game's raw answer, not the inherited one | Accepted for the rollout, given the small user base. Noted in the release notes (§4, Availability) |
| D15 | Cancelling and restoring | Cancel offers "and its remaining games" or "keep them as standalone games". Restore restores the tournament only. Games are restored one by one |
| D16 | Bulk fill when a tournament and its games are unanswered | Answer only the tournament |
| D16b | The bulk fill's `'game'` filter and tournament games | Standalone games only. Tournament games are answered through their tournament |
| D17 | One league per season, archiving, and the old `teams.league` fields | Per season, and archiving keeps records. The old fields stay for now, relabeled as display text and unused for records; retiring them is a later, separate change |
| D18 | Tournaments and recurring series | A tournament and its games are always standalone. A trigger refuses series links |

## 7. Compatibility with the installed 1.0.12 (D4 of the mobile spec)

Everything here is additive: new nullable columns, a new table, and one new event type value. Checked against
1.0.12's source (`b3473c71b`):
- **Badge and title:** the default (purple) badge reading "Tournament" (its style capitalizes the stored
  word), and the title. Fine.
- **Times:** its event screen shows the start, then "Ends" with a time and no date (`[eventId].tsx:288`), in
  the phone's zone. For an all-day tournament that's midnight, "Ends 12:00 AM" for someone in the
  tournament's zone. Misleading, and noted in the release notes.
- **Upcoming:** its home screen queries `start_time >= now`, so an underway tournament drops off its Upcoming
  list on its first day. Its games still show. Accepted.
- **Answers (D14):** it shows a tournament game's own answer, or "no response", never the inherited one. Its
  writes are plain rows, which the new rules still accept. Clearing a game's answer in 1.0.12 deletes the
  override, the same as in 1.1.0. Only the display differs.
- **Games:** shown as ordinary games, without their tournament or round.
- **Leagues:** 1.0.12 never reads `leagues` or `league_id`.
- **Refusals:** the new triggers (same team, standalone, games only) apply to event writes, which 1.0.12 never
  makes.

## 8. Testing

- **Database (`tests/rls/`):**
  - a game can link only to a tournament on its own team
  - a series head or child can't link to a tournament, and a tournament or tournament game can't be made
    recurring (D18)
  - tournament fields are refused on non-tournaments, and `league_id` and `round` on non-games
  - only team admins set placement
  - a plain delete of a tournament with games is refused, and the delete-with-games function removes exactly
    its games and answers (D5)
  - cancel with games, cancel keeping games (unlinked), and restore not restoring games (D15)
  - a tournament-wide action enqueues **one** job with the tournament's snapshot, and no game jobs
  - `set_unanswered_availability` answers only the tournament when all are unanswered, skips games under an
    answered tournament, and accepts `'tournament'` (D16)
  - a league must be the team's own, and tagging past games enqueues nothing
- **Queries:**
  - an underway tournament is in Upcoming
  - one crossing a month boundary is in both months
  - schedule pages keep their order, with games and their tournament on different pages
- **Rules (web and phone, the same cases):**
  - `effectiveAnswer`: a game's own answer wins, else the tournament's, else none, and clearing falls back
  - the tournament record counts only its games
  - placement text (the label wins, else an ordinal)
  - all-day date ranges in the tournament's zone, across daylight saving
  - league records by league, and the overall record counts everything
- **Web:**
  - creating in one call with one notice, in the tournament template
  - the tournament page
  - the cancel, restore and delete choices
  - "Part of"
  - the "League games" action including past games
  - the Record card's league rows
- **Worker:** a tournament job renders the tournament template whatever its count. Per action (§4,
  Notifications):
  - created, updated and restored link to the tournament page, with answer buttons for the tournament
  - cancelled links to the tournament page, with no buttons
  - deleted links to the schedule, with no buttons
- **Mobile:** the tournament card ("Now" while underway) and screen, date ranges, "Part of", the game's
  inherited answer and override, and league rows on the Record card.
- **Compatibility:** the release notes' 1.0.12 review gains these migrations and the D14 difference.

## 9. Review, 2026-10-01

The user's review of the first draft changed:
1. **The 1.0.12 answer difference:** it's more than "less complete", and is now accepted explicitly (D14).
2. **Multi-day queries:** added (§4, "Multi-day events in queries"): overlap, staying in Upcoming until the
   end, month boundaries, and no nesting across pages.
3. **Tournament notifications:** added (§4, "Notifications"). Batches keep the first snapshot and render as a
   series today, so tournament actions enqueue their own job and get their own template.
4. **League tagging:** moved out of the series editor, into a separate classification action that includes
   played games (§5).
5. **Series and tournaments:** made exclusive (D18).
6. **Where notices link:** deleted tournament notices link to the schedule, not the gone tournament, and
   cancelled and deleted notices carry no answer buttons (§4, Notifications), as for single events today.

It also settled cancelling and restoring (D15), one league per season with archiving and the old team fields
(D17), bulk fill and its games-only filter (D16, D16b), and all-day dates (D13). It changed the release:
1.1.0 waits for leagues too (D11, D12).
