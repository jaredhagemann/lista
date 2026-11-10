# Record card: a tournament in progress

**Status:** Built on `feature/tournament-in-progress-record` (web and mobile)
**Requested:** 2026-11-09 by the product owner
**Builds on:** `docs/specs/tournaments-and-leagues.md` D8 (the dashboard after a tournament, revised
2026-10-14) and D9 (Record card layout), and the card's visibility rule (decided 2026-10-15)

## Problem

The dashboard's Record card shows a tournament only once it has **finished** (`end_time` has passed). During
a tournament weekend, the time families most want to see how it's going, the card says nothing about it: no
tournament record, no latest result, no sense of what's left. Until the tournament ends, the "Last tournament"
section still shows the previous one.

## Proposal

A tournament shows on the Record card **from its first game with a result**, not from its end. While it's
underway, its section shows:

1. **The latest result**: the tournament's most recent game with a result, as the existing "Last game"
   scoreline (score, or Win/Loss/Tie when unscored; date and time in its zone).
2. **The tournament record**: wins, losses and ties over its games so far, with the record bar, headed
   "Tournament Record", as today.
3. **The remaining games**: the tournament's games without a result, in start order, each with its date and
   time, opponent ("vs"/"at", or "Opponent TBD" when not set), and round when set ("Semifinal").

The name, dates and placement (if set) stay as they are today. Once the tournament ends, the section becomes
the existing "Last tournament" section unchanged, with no remaining-games list, until a newer one finishes.

### Which tournament the section shows

| Situation | Section shows |
| --- | --- |
| No tournament underway, or one underway with no results yet | The latest finished tournament, as today (or nothing) |
| A tournament underway with at least one result | That tournament, in progress |
| Two underway with results (rare: overlapping events) | The one that started most recently |
| The in-progress one ends | It is now the latest finished, so it shows as "Last tournament" |

"Underway" uses the existing `isUnderway()`: started (`start_time <= now`) and not yet ended
(`now < end_time`), so whole days in the tournament's zone (D13). Cancelled tournaments never show. A
tournament that has a result before its start date (a data-entry mistake) isn't treated as underway.

### Card visibility

The card's rule becomes: a game has a result, a tournament has finished, **a tournament underway has a
result**, or the team has an active league. In practice the new case is already covered, since a tournament
game with a result is a game with a result; it's listed for clarity and for the tests.

## Decisions (2026-11-09, product owner)

All nine accepted as proposed.

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Section heading while underway | "Current tournament", with the existing "Now" badge used in Upcoming. "Last tournament" once it ends |
| Q2 | Without leagues, the card already opens with the team's last game, which during a tournament is usually the same game as the tournament's latest result | Show it once: while a tournament is in progress, drop the top "Last game" when it's the same game as the tournament's latest result. Keep it when it differs (e.g. a league game played the same weekend). With leagues, each league section keeps its own last game as today |
| Q3 | A remaining game whose start time has passed but has no result yet (being played, or not entered) | List it with the others, marked "Awaiting result" rather than a time |
| Q4 | Cancelled tournament games | Left out of the remaining list and the record |
| Q5 | All games have results but the tournament hasn't ended (a free last day, or later bracket games not yet added) | Show the section with no remaining list, and no "no games left" message, since bracket games are often added late |
| Q6 | How many remaining games to list | All of them; tournaments rarely have more than 5–6 |
| Q7 | Each remaining game links to its event page | Yes, as Upcoming does |
| Q8 | Mobile | Same change in the same release; the mobile Record card mirrors the web one (D8 applies to both). Mobile ships with the next build (1.1.1) |
| Q9 | The previous tournament while a new one is in progress | Replaced by the new one; only one tournament section on the card |

## Changes

### Web

- `apps/web/src/lib/events/tournament.ts`:
  - `recordCardTournament(underway, finished, resultGames, now)` picks the tournament (the table above) and
    returns `{ tournament, current }`, or null.
  - `remainingGames(games, now)` keeps games without a result and not cancelled, in start order, as
    `{ id, startTime, timeZone, opponent, homeAway, round, awaiting }`. `awaiting` means it has started (Q3).
- `apps/web/src/lib/events/team-record.ts`: a game's `id` is carried to `last`. The card uses it to tell
  whether the team's last game is the tournament's latest result (Q2).
- `apps/web/src/app/dashboard/page.tsx`:
  - A read of the team's tournaments underway (`event_type = 'tournament'`, not cancelled,
    `start_time <= now < end_time`), alongside the existing reads.
  - Only when a tournament is current, a second read of its games without a result (`tournament_id`, game,
    not cancelled, `game_result is null`, by `start_time`). A tournament weekend costs one extra round trip.
  - The games-with-a-result read now selects `id`.
  - Either new read failing sets `recordFailed`, as the other record reads do (TL-026).
- `apps/web/src/components/team/record-card.tsx`:
  - The `lastTournament` prop is now `tournament: CardTournament`, with `current` and `remaining`.
  - While current, the section is "Current tournament" with a "Now" badge. The summary and the latest result
    ("Latest result", reusing the last-game scoreline) are on the left, the Tournament Record on the right.
    The "Remaining games" list sits below, each game linking to its page.
  - The top "Last game" is hidden when it's the same game as the latest result (Q2).

### Mobile

- `apps/mobile/lib/tournament.ts` and `lib/team-record.ts`: the same helpers and `id`, copied.
- `apps/mobile/app/(app)/index.tsx`: the same reads. The remaining-games read is also checked against the
  latest-read counter (TL-027).
- `apps/mobile/components/RecordCard.tsx`: the same section. Remaining games are buttons that open the game
  through `onOpenGame`.

### Docs

- `docs/specs/tournaments-and-leagues.md`: D8 and the Records paragraph point here.

No schema change and no migration: everything needed (`tournament_id`, `round`, `game_result`,
`is_cancelled`) already exists, and the reads are the team's own events under the existing RLS policies.

## Tests (written first)

**Selection helper** (web and mobile):
- No tournament underway: the latest finished one, as today.
- Underway with no results: the latest finished one (or null).
- Underway with one result: that tournament, `status: "current"`, its record from that one game, `latest`
  that game, and every other game remaining.
- The remaining list leaves out games with a result and cancelled games, and is in start order.
- Two underway with results: the one that started most recently.
- After `end_time`: `status: "last"`, no remaining list, even with games still lacking results.
- A result on a tournament that hasn't started: not current.
- Day boundaries in the tournament's zone (a minute before and after midnight ending its last day).

**Record card** (web and mobile render tests):
- Current tournament: the heading and badge, the latest result's scoreline, the Tournament Record, and the
  remaining games with opponent, round, "Opponent TBD", and "Awaiting result" for a past start (Q3).
- All games played, tournament still underway: no remaining list and no message (Q5).
- Without leagues: the top "Last game" is hidden when it matches the tournament's latest result, shown when
  it doesn't (Q2). With leagues: league sections unchanged.
- Finished tournament: renders exactly as today (regression guard for D8).
- The card shows for a team whose only result is in a tournament underway.
- A failed underway or remaining-games read shows "Couldn't load the record", not a partial card.

**Dashboard page:** the queries' filters (team, not cancelled, underway window, no result) and that a read
error sets `failed`.
