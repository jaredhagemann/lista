/**
 * Managing a tournament: its days, its games, and the database's refusals
 * (docs/specs/tournaments-and-leagues.md §4; part 2b).
 *
 * A tournament is whole days in its zone (D13): stored as midnight starting its
 * first day to midnight ending its last, as create_tournament stores it. Its
 * games have real times, and may fall outside its days — the forms warn, but
 * schedules slip, so nothing refuses them.
 */

import { instantFromWallClock, wallClockIn } from "@/lib/events/event-timezone";
import { gameTitle } from "@/lib/events/game-display";
import { resolveTimeZone } from "@/lib/notifications/event-time";

type Timed = { start_time: string; end_time: string; timezone?: string | null };

/** "YYYY-MM-DD" plus one day, as a calendar date: daylight saving can't touch it. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Midnight starting `firstDay` to midnight ending `lastDay`, in `zone`. */
export function tournamentBounds(
  firstDay: string,
  lastDay: string,
  zone: string
): { start_time: string; end_time: string } {
  return {
    start_time: instantFromWallClock(`${firstDay}T00:00`, zone).toISOString(),
    end_time: instantFromWallClock(`${nextDay(lastDay)}T00:00`, zone).toISOString(),
  };
}

/** Its first and last day, read in its own zone (else `fallbackZone`). */
export function tournamentDays(
  event: Timed,
  fallbackZone?: string | null
): { firstDay: string; lastDay: string } {
  const zone = resolveTimeZone(event.timezone ?? fallbackZone);
  return {
    firstDay: wallClockIn(event.start_time, zone).slice(0, 10),
    // The day before midnight ending it.
    lastDay: wallClockIn(new Date(Date.parse(event.end_time) - 60_000), zone).slice(0, 10),
  };
}

/** Whether `instant` falls on one of the days `firstDay`–`lastDay` in `zone`. */
export function isWithinDays(instant: string | Date, firstDay: string, lastDay: string, zone: string): boolean {
  const day = wallClockIn(instant, zone).slice(0, 10);
  return day >= firstDay && day <= lastDay;
}

/** The games, not cancelled, that start outside the days: the coach may want to move them. */
export function gamesOutsideDays<G extends { start_time: string; is_cancelled?: boolean | null }>(
  games: G[],
  firstDay: string,
  lastDay: string,
  zone: string
): G[] {
  return games.filter((g) => !g.is_cancelled && !isWithinDays(g.start_time, firstDay, lastDay, zone));
}

/**
 * The title a tournament game is stored with. The web names a game by its team
 * and opponent whatever its title, but the installed 1.0.12 shows the stored
 * one, so it should read on its own: the matchup, else the round, else "Game".
 */
export function tournamentGameTitle(
  game: { opponent?: string | null; home_away?: string | null; round?: string | null },
  teamName: string
): string {
  if (game.opponent?.trim()) {
    return gameTitle({ title: "", event_type: "game", opponent: game.opponent, home_away: game.home_away }, teamName);
  }
  return game.round?.trim() || "Game";
}

/** A game as the tournament forms hold it: wall-clock times in the tournament's zone. */
export type TournamentGameDraft = {
  start: string;
  end: string;
  opponent: string;
  homeAway: string;
  uniform: string;
  round: string;
};

const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Why a drafted game can't be saved, or null. It has to end after it starts
 * (review TL-012): the database refuses otherwise, and checking here means
 * nothing is written first. Compared as typed, in the one zone both are in.
 */
export function gameTimesError(draft: Pick<TournamentGameDraft, "start" | "end">): string | null {
  if (!WALL.test(draft.start) || !WALL.test(draft.end)) return "Enter when the game starts and ends.";
  return draft.end > draft.start ? null : "A game has to end after it starts.";
}

/**
 * A drafted game as an `events` row's fields: what create_tournament takes per
 * game. It's at `locationId`, the tournament's (review TL-013): the forms have
 * no venue per game.
 */
export function tournamentGameFields(
  draft: TournamentGameDraft,
  zone: string,
  teamName: string,
  locationId: string | null
) {
  const opponent = draft.opponent.trim() || null;
  const homeAway = draft.homeAway || null;
  const round = draft.round.trim() || null;
  return {
    title: tournamentGameTitle({ opponent, home_away: homeAway, round }, teamName),
    start_time: instantFromWallClock(draft.start, zone).toISOString(),
    end_time: instantFromWallClock(draft.end, zone).toISOString(),
    opponent,
    home_away: homeAway,
    uniform: draft.uniform || null,
    round,
    location_id: locationId,
  };
}

/** `p_games` for create_tournament, each at the tournament's location. */
export function tournamentGamesPayload(
  drafts: TournamentGameDraft[],
  zone: string,
  teamName: string,
  locationId: string | null
) {
  return drafts.map((d) => tournamentGameFields(d, zone, teamName, locationId));
}

const MESSAGES: Record<string, string> = {
  INVALID_TOURNAMENT_DAYS: "The last day can't be before the first.",
  INVALID_GAME_TIMES: "A game has to end after it starts.",
  NOT_AUTHORIZED: "Only a coach or manager can do that.",
  ALREADY_CANCELLED: "This tournament is already cancelled.",
  TOURNAMENT_NOT_FOUND: "This tournament no longer exists. Refresh to see the schedule.",
  TOURNAMENT_HAS_GAMES: "A tournament with games keeps its type and team. Cancel or delete it with its games instead.",
  TOURNAMENT_NOT_A_SERIES: "A tournament and its games are never part of a recurring series.",
  NOT_A_TOURNAMENT: "A game can only be part of a tournament.",
  TOURNAMENT_TEAM_MISMATCH: "A game can only be part of its own team's tournament.",
};

/** The database's refusal as a sentence, or its own message when it isn't one of ours. */
export function tournamentErrorMessage(error: { message: string }): string {
  const code = error.message.match(/^([A-Z_]+)(?::|$)/)?.[1];
  return (code && MESSAGES[code]) || error.message;
}
