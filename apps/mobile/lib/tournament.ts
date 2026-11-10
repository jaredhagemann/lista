/**
 * How a tournament reads: the web's rules, copied (docs/specs/tournaments-and-
 * leagues.md §4, §8). Keep in step with apps/web/src/lib/events/tournament.ts.
 *
 * A tournament is an event spanning whole days in its zone (D13), stored as
 * midnight starting its first day to midnight ending its last. Its games point
 * at it through `tournament_id`.
 */

import { eventZone, formatEventDay } from "./event-time";
import { teamRecord, type ResultGame, type TeamRecord } from "./team-record";

type Timed = {
  start_time: string;
  end_time: string;
  timezone?: string | null;
  teams?: { timezone: string | null } | null;
};

export function isTournament(event: { event_type: string }): boolean {
  return event.event_type === "tournament";
}

/**
 * "Fri, Oct 11 – Sun, Oct 13", or one day alone, in the tournament's zone (else
 * its team's). The last day is the day before `end_time`, midnight ending it.
 */
export function tournamentDates(event: Timed): string {
  const zone = eventZone(event);
  const first = formatEventDay(event.start_time, zone);
  const last = formatEventDay(new Date(Date.parse(event.end_time) - 60_000), zone);
  return first === last ? first : `${first} – ${last}`;
}

/** Started, and not yet ended. */
export function isUnderway(event: { start_time: string; end_time: string }, now: Date = new Date()): boolean {
  return Date.parse(event.start_time) <= now.getTime() && now.getTime() < Date.parse(event.end_time);
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** "Gold bracket champions" when labelled, else "2nd place"; null until set. */
export function placementText(event: { placement_rank?: number | null; placement_label?: string | null }): string | null {
  const label = event.placement_label?.trim();
  if (label) return label;
  return event.placement_rank != null ? `${ordinal(event.placement_rank)} place` : null;
}

/** "Surf Cup · Semifinal" under a game, or null for a game outside a tournament. */
export function tournamentLine(game: { round?: string | null; tournament?: { title: string } | null }): string | null {
  if (!game.tournament) return null;
  const round = game.round?.trim();
  return round ? `${game.tournament.title} · ${round}` : game.tournament.title;
}

/** Wins, losses and ties over this tournament's own games with a result. */
export function tournamentRecord(
  tournamentId: string,
  games: (ResultGame & { tournament_id?: string | null })[],
  now: Date = new Date()
): TeamRecord | null {
  return teamRecord(
    games.filter((g) => g.tournament_id === tournamentId),
    now
  );
}

/** "2 games", "1 game". */
export function gameCount(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

// ── A tournament in progress (docs/specs/tournament-in-progress-record.md) ────

/**
 * Which tournament the Record card shows, and whether it's still on. A
 * tournament underway shows from its first game with a result, the most
 * recently started if two are (rare). Until then, and once it ends, the latest
 * finished one, as before (D8). Only one shows (Q9).
 */
export function recordCardTournament<T extends Timed & { id: string }>(
  underway: T[],
  finished: T | null | undefined,
  games: (ResultGame & { tournament_id?: string | null })[],
  now: Date = new Date()
): { tournament: T; current: boolean } | null {
  const current = underway
    .filter((t) => isUnderway(t, now) && tournamentRecord(t.id, games, now) !== null)
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))[0];
  if (current) return { tournament: current, current: true };
  return finished ? { tournament: finished, current: false } : null;
}

/** A game still to be played, or played and waiting for its result (Q3). */
export type RemainingGame = {
  id: string;
  startTime: string;
  timeZone: string | null;
  opponent: string | null;
  homeAway: string | null;
  round: string | null;
  /** Started, with no result yet: it reads "Awaiting result" rather than a time. */
  awaiting: boolean;
};

/** A tournament's games without a result, cancelled ones left out (Q4), in start order. */
export function remainingGames(
  games: {
    id: string;
    start_time: string;
    timezone?: string | null;
    opponent?: string | null;
    home_away?: string | null;
    round?: string | null;
    game_result?: string | null;
    is_cancelled?: boolean | null;
  }[],
  now: Date = new Date()
): RemainingGame[] {
  return games
    .filter((g) => !g.is_cancelled && !g.game_result)
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
    .map((g) => ({
      id: g.id,
      startTime: g.start_time,
      timeZone: g.timezone ?? null,
      opponent: g.opponent?.trim() || null,
      homeAway: g.home_away ?? null,
      round: g.round?.trim() || null,
      awaiting: Date.parse(g.start_time) <= now.getTime(),
    }));
}
