/**
 * Leagues on the phone: the web's rules, copied (docs/specs/tournaments-and-
 * leagues.md §5; D9, D17). Keep in step with apps/web/src/lib/leagues.ts.
 *
 * Display only: leagues are made and tagged on the web (D11).
 */

import { teamRecord, type ResultGame, type TeamRecord } from "./team-record";

export type League = { id: string; name: string; season: string; archived_at: string | null };

/** "Fall 2026 Division 3": the season, then the name. */
export function leagueLabel(league: { name: string; season: string }): string {
  return `${league.season} ${league.name}`;
}

/** Leagues not archived (D17), by label. */
export function activeLeagues<L extends { name: string; season: string; archived_at: string | null }>(leagues: L[]): L[] {
  return leagues.filter((l) => !l.archived_at).sort((a, b) => leagueLabel(a).localeCompare(leagueLabel(b)));
}

/**
 * A section per active league for the Record card (D9): its label and its record
 * over its own games with a result, or null before it has one.
 */
export function leagueRecords(
  leagues: League[],
  games: (ResultGame & { league_id?: string | null })[],
  now: Date = new Date()
): { id: string; label: string; record: TeamRecord | null }[] {
  return activeLeagues(leagues).map((l) => ({
    id: l.id,
    label: leagueLabel(l),
    record: teamRecord(
      games.filter((g) => g.league_id === l.id),
      now
    ),
  }));
}
