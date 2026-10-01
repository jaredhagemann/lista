# Spec — Tournaments and leagues

**Status:** Draft, for discussion. The modeling choices are open: see §6 for the questions and the
recommendations. Nothing is built until they're settled.
**Requested:** 2026-10-01, by the user. To be decided before the 1.1.0 mobile release, because tournaments may
change what the app's schedule and event screens show.
**Scope:** database, web and the mobile app.

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
  (`20260101000000_initial_schema.sql`).
- **Game fields live on the event:** `opponent`, `home_away`, `uniform`, `score_for`, `score_against` and
  `game_result`.
- **The record:** wins, losses and ties are counted over every past game with a result (`lib/events/team-record.ts`,
  on both the web and the phone). There's no grouping of games.
- **Series:** a recurring series is a head event with `recurrence_rule`, and children point at it through
  `events.parent_event_id` (BUG-009). That link means "an occurrence of this series", **not** "part of this
  tournament", and tournaments shouldn't reuse it.
- **Notifications:** jobs are batched per transaction, team and action
  (`20260917000007_notification_jobs.sql`). Creating a tournament and its games in one save sends one
  notification, not one per game.
- **What branches on `event_type`:**
  - on the web: the calendar, schedule list, event page and form, the series editor, the availability matrix,
    the dashboard, the reminders cron, the notification worker and dispatch, the event email, and game titles
  - on the phone: the home, schedule and event screens, and `lib/game-display.ts`

## 3. Modeling tournaments: options

| | A. A tournament is an event | B. A separate `tournaments` table | C. A tag on games only |
| --- | --- | --- | --- |
| **Shape** | A new `event_type = 'tournament'`, spanning its days. Each game points to it through a new `events.tournament_id`. | `tournaments(team_id, name, dates, location, placement…)`, and games point to it through `events.tournament_id`. | `events.tournament_name` text on each game. |
| **On the schedule, calendar, reminders** | Free: it's an event. One card for the weekend, plus its games. | Needs new rendering everywhere a schedule is shown. | Only the games show. Nothing ties them together. |
| **"Are you coming?"** | Free: availability on the tournament event. | New availability table, or per game only. | Per game only. |
| **Placement and record** | Columns on the tournament event, and its record from the games pointing to it. | Columns on `tournaments`, and the same record. | Placement has nowhere to live. A record by name works until it's misspelled. |
| **1.0.12 on phones** | Shows the tournament as an event with an unknown type: a plain badge, the title, and times. It works, but looks a bit off (§7). | Doesn't see tournaments at all, only their games. | Unaffected. |
| **Cost** | Moderate. The type, two columns, a link and its rules, plus UI. | Highest. New schedule plumbing on both apps. | Lowest, but it doesn't meet the need. |

**Recommendation: A.** You described tournaments as an event type, and that's where the machinery already is:
schedule, calendar, availability, reminders, notifications and the event page. A tournament gains its own
fields on the event row, the same way game details already live on `events`.

## 4. Tournaments: proposed design (option A)

### Data

- **Event type:** `event_type` allows `'tournament'`.
- **Tournament fields** (new, nullable, on `events`; only a tournament may set them):
  - `placement_rank int`: 1, 2, 3… Shown as "1st place" when there's no label.
  - `placement_label text`: free text, e.g. "Gold bracket champions" or "Group stage". It wins over the rank
    when both are set.
- **Link from game to tournament:** `tournament_id uuid references events(id)`, nullable, on game events.
  - A database rule (trigger) enforces that it points at a tournament on the **same team**.
  - Deleting a tournament: either its games become standalone, or deletion is refused while it has games.
    See D5.
- **Days:** the tournament's `start_time` and `end_time` span its days, in its zone (`events.timezone`).
  - A game's time should fall inside the tournament's days. Warn in the form, but don't enforce it in the
    database: schedules slip.
- **No repeats:** a tournament can't be recurring (`recurrence_rule` stays null).

### Rules

- **Tournament record:** wins, losses and ties over its games with a result. It's `teamRecord` over the
  games where `tournament_id` equals the tournament.
- **Overall record:** still every game, tournament games included (D3).
- **Placement:** set by a team admin on the tournament, usually at the end. It isn't derived from the games.
- **Title:** the tournament's own title ("Surf Cup"). Its games keep `gameTitle` ("U10 Girls vs Rivals FC").
  Where a game is shown outside its tournament, a line under it names the tournament.

### Web

- **Create a tournament:** name, dates, location and notes, then add games to it: a time, opponent,
  home/away, uniform, and optionally a round ("Pool A", "Semifinal"; see D7). It's saved in one transaction,
  so there's one notification.
- **Tournament page:** dates, location, placement, and its record. Its games in order, each with its score and
  result. "Are you coming?" for the tournament (D2).
- **Schedule and calendar:** the tournament as one item spanning its days (a multi-day bar on the calendar),
  with its games under it or indented in the list. To check: the calendar draws only the start day for
  multi-day events today.
- **Game page:** a "Part of Surf Cup" link back to the tournament.
- **Dashboard:**
  - Upcoming events show the tournament once, with its dates.
  - The Record card stays overall.
  - When a tournament ends with a placement, it shows as the last result, e.g. "Surf Cup · 2nd place · 3–1–0"
    (D8).
- **Emails and notifications:**
  - A tournament reads "Surf Cup · Sat Oct 12 – Sun Oct 13".
  - Games name their tournament.
  - Reminders go out for the tournament, not for each game (D6).

### Mobile app

The same as the web, read-only for now, since the app doesn't create events:
- **Schedule and home:** one card for the tournament, showing its date range.
- **Tournament screen:** dates, location, placement and record, its games, and the availability picker.
- **Game screen:** "Part of Surf Cup".
- **Multi-day times:** the event screen reads "Sat Oct 12 – Sun Oct 13" instead of "Ends 5:00 PM".

## 5. Leagues

### Options

| | A. Free-text tag on games | B. Team leagues | C. Club leagues |
| --- | --- | --- | --- |
| **Shape** | `events.league text` | `leagues(team_id, name, season)`, and games carry `league_id` | `leagues(organization_id, name, season)`, plus `team_leagues`, and games carry `league_id` |
| **Record by league** | Grouped by text. A typo splits a record. | Exact. | Exact, and the same league across a club's teams. |
| **Entering it** | Type it on every game. | Pick from the team's leagues, or add one in team settings. | A club defines it once, and teams join it. |
| **Fits** | A quick start. | Any team, free or club. | Clubs. Later, standings across a club's teams. |

**Recommendation: B, team leagues.** It's exact, it works for free teams, and it can grow into C: add
`organization_id` later, and let club teams share a league.

### Proposed design (B)

- **Data:** `leagues(id, team_id, name, season text null, archived_at null)`, plus `events.league_id`
  (nullable, games only, and the league must be the event's own team's).
- **Entering it:**
  - The game form gets a League picker (the team's leagues, plus "Add league…").
  - The series editor can set it for a whole series of league games.
  - Team settings list the leagues.
- **Records:** overall (every game), plus one per league. The Record card shows the overall record. With
  leagues, it adds a row per active league, e.g. "Fall League 6–2–1", or a picker (D9).
- **Schedule:** a small league tag on league games.
- **Tournaments and leagues are independent:** a game can carry either, or both. For example, a league's cup
  played as a tournament. Tournament games aren't league games unless tagged (D4).

## 6. Questions to settle

| # | Question | Recommendation | Decision |
| --- | --- | --- | --- |
| D1 | How is a tournament modeled? | **A:** a `tournament` event type, with games linked by `events.tournament_id` (§3). | Open |
| D2 | Where do people answer "are you coming?" | **On the tournament.** One answer for the weekend. Per-game answers stay possible but aren't asked for. Coaches mostly need "who's coming to Surf Cup". | Open |
| D3 | Do tournament games count toward the overall record? | **Yes.** The overall record is every game, and the tournament adds its own record next to it. | Open |
| D4 | Can a game be in both a league and a tournament? | **Yes, independently.** Nothing is inherited. | Open |
| D5 | Deleting a tournament that has games | **Refuse while it has games, and offer "delete the tournament and its games"**, like a series (BUG-009). Games aren't left orphaned silently. | Open |
| D6 | Reminders for a tournament | **One reminder for the tournament** (its first day). None for each of its games. | Open |
| D7 | A round on each game ("Pool A", "Semifinal")? | **Yes, optional `events.round text`.** It's cheap and makes the game list read right. | Open |
| D8 | The dashboard after a tournament | **Show the placement as the last result** until a newer game. "Surf Cup · 2nd place · 3–1–0". | Open |
| D9 | Leagues on the Record card | **A row per active league** under the overall record. On the web, maybe a season view later (roadmap: Stats & Season Records). | Open |
| D10 | League model | **B:** team leagues (§5). Club leagues later. | Open |
| D11 | Mobile before 1.1.0? | **Display only:** tournament cards, the tournament screen, "Part of", multi-day dates, league tags and records. Creating them stays on the web. | Open |
| D12 | Order of work | **Tournaments first** (the schema, then web, then mobile), **then leagues.** Leagues don't change what 1.0.12 sees, so they don't hold the release. | Open |

## 7. Compatibility with the installed 1.0.12 (D4 of the mobile spec)

Everything here is additive, nullable columns and one new event type value, but 1.0.12 will see tournaments.
Checked against 1.0.12's source:
- **Badge and title:** it shows a tournament with the default (purple) badge reading "Tournament" (its style
  capitalizes the stored word), and its title. That's fine.
- **Times:** its event screen shows the start date and time, then "Ends 5:00 PM" with no date
  (`[eventId].tsx:288` at `b3473c71b`), which is misleading for a three-day event. Acceptable for a
  transition, but worth noting in the release notes.
- **Availability:** works on a tournament like any event.
- **Games:** show as ordinary games, without their tournament.
- **Leagues:** 1.0.12 never reads `league_id`, so nothing changes for it.
- **Refusals:** no new refusal affects 1.0.12's writes. Its writes are availability, chat, profiles and
  preferences, and none of the new rules touch them.

This is why tournaments should land before 1.1.0 ships: 1.1.0 should show them properly from day one.

## 8. Testing (once decided)

- **Database (`tests/rls/`):**
  - a game can link only to a tournament on its own team
  - only team admins set placement
  - the tournament fields are refused on non-tournaments
  - deletion follows D5
  - a league must be the team's own
- **Rules (web and phone, the same cases):**
  - the tournament record counts only its games
  - placement text (label wins, ordinal otherwise)
  - league records split by league, and the overall record counts everything
- **Web:** the tournament form saves in one transaction with one notification; the schedule shows one item per
  tournament; the tournament page; the game's "Part of" link; the Record card's league rows.
- **Mobile:** the tournament card and screen, the date range, "Part of", and the league rows on the Record
  card.
- **Compatibility:** the release notes' 1.0.12 review is extended to cover the new type and columns.
