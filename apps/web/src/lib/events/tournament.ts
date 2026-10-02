/**
 * How a tournament reads (docs/specs/tournaments-and-leagues.md §4).
 *
 * A tournament is an event spanning whole days in its zone (D13), stored as
 * midnight starting its first day to midnight ending its last. Its games point
 * at it through `tournament_id`.
 */

import { formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";
import { teamRecord, type ResultGame, type TeamRecord } from "@/lib/events/team-record";

type Timed = { start_time: string; end_time: string; timezone?: string | null };

export function isTournament(event: { event_type: string }): boolean {
  return event.event_type === "tournament";
}

/**
 * "Fri, Oct 11 – Sun, Oct 13", or one day alone. The last day is the day before
 * `end_time` (midnight ending it), read in the tournament's zone. A minute
 * before midnight is still that day, whatever the clocks did in between.
 */
export function tournamentDates(event: Timed, fallbackZone?: string | null): string {
  const zone = resolveTimeZone(event.timezone ?? fallbackZone);
  const first = formatShortEventDate(event.start_time, zone);
  const last = formatShortEventDate(new Date(Date.parse(event.end_time) - 60_000), zone);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Each day it covers, as YYYY-MM-DD keys in `zone` (the calendar's), first to
 * last. The last is the day before `end_time`, as in tournamentDates.
 */
export function tournamentDayKeys(event: Timed, zone: string | null | undefined): string[] {
  const resolved = resolveTimeZone(zone);
  const key = (instant: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: resolved, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(instant)
    );
  const first = key(Date.parse(event.start_time));
  const last = key(Date.parse(event.end_time) - 60_000);
  const keys: string[] = [];
  // Step through calendar dates as dates: daylight saving can't skip or repeat one.
  for (let d = new Date(`${first}T00:00:00Z`); keys.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    keys.push(k);
    if (k >= last) break;
  }
  return keys;
}

/** Started, and not yet ended. */
export function isUnderway(event: Timed, now: Date = new Date()): boolean {
  return Date.parse(event.start_time) <= now.getTime() && now.getTime() < Date.parse(event.end_time);
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** "Gold bracket champions" when labelled, else "2nd place"; null until set. */
export function placementText(event: {
  placement_rank?: number | null;
  placement_label?: string | null;
}): string | null {
  const label = event.placement_label?.trim();
  if (label) return label;
  return event.placement_rank != null ? `${ordinal(event.placement_rank)} place` : null;
}

/** "Surf Cup · Semifinal" under a game, or null for a game outside a tournament. */
export function tournamentLine(game: {
  round?: string | null;
  tournament?: { title: string } | null;
}): string | null {
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
