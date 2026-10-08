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
