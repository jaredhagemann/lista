/**
 * Leagues on the web (docs/specs/tournaments-and-leagues.md §5; D17, D20, D21).
 *
 * A league is a team's, for one season: "Division 3", "Fall 2026", shown as
 * "Fall 2026 Division 3". Games carry it in events.league_id.
 */

import type { Database } from "@/types/database";

export type League = Database["public"]["Tables"]["leagues"]["Row"];

/**
 * A name or season as the database compares it for D21: edges trimmed and runs
 * of spaces collapsed. Case is kept as typed; the database ignores it.
 */
export function normalizeLeagueText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** "Fall 2026 Division 3": the season, then the name. */
export function leagueLabel(league: Pick<League, "name" | "season">): string {
  return `${league.season} ${league.name}`;
}

/** Leagues not archived (D17), by label: what pickers and the Record card offer. */
export function activeLeagues<L extends Pick<League, "name" | "season" | "archived_at">>(leagues: L[]): L[] {
  return leagues.filter((l) => !l.archived_at).sort((a, b) => leagueLabel(a).localeCompare(leagueLabel(b)));
}

/** The database's refusal as a sentence, or its own message when it isn't one of these. */
export function leagueErrorMessage(error: { code?: string; message: string }): string {
  if (error.message.startsWith("LEAGUE_HAS_GAMES")) {
    return "This league has games, so it can't be deleted. Archive it instead: that keeps its record.";
  }
  if (error.message.startsWith("LEAGUE_TEAM_MISMATCH")) return "A game can only be in its own team's league.";
  if (error.message.startsWith("LEAGUE_TEAM_FIXED")) return "A league stays on its team.";
  if (error.message.startsWith("CLUB_CLOSED")) return "This club is closed, so its leagues can't be changed.";
  if (error.code === "23505") return "There's already a league with that name and season.";
  return error.message;
}
