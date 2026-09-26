/**
 * A team's record and latest result (spec: docs/specs/team-branding-and-labels.md §4).
 *
 * Counted over every game with a result entered; games without one don't count.
 */

export type ResultGame = {
  start_time: string;
  timezone?: string | null;
  opponent?: string | null;
  home_away?: string | null;
  game_result: string | null;
  score_for?: number | null;
  score_against?: number | null;
};

export type TeamRecord = {
  wins: number;
  losses: number;
  ties: number;
  last: {
    result: "win" | "loss" | "tie";
    scoreFor: number | null;
    scoreAgainst: number | null;
    opponent: string | null;
    homeAway: string | null;
    startTime: string;
    timeZone: string | null;
  };
};

const RESULTS = new Set(["win", "loss", "tie"]);

/** Null when no game has a result yet. */
export function teamRecord(games: ResultGame[], now: Date = new Date()): TeamRecord | null {
  const played = games
    .filter((g) => g.game_result && RESULTS.has(g.game_result) && Date.parse(g.start_time) <= now.getTime())
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  if (played.length === 0) return null;

  const count = (r: string) => played.filter((g) => g.game_result === r).length;
  const latest = played[0];
  return {
    wins: count("win"),
    losses: count("loss"),
    ties: count("tie"),
    last: {
      result: latest.game_result as "win" | "loss" | "tie",
      scoreFor: latest.score_for ?? null,
      scoreAgainst: latest.score_against ?? null,
      opponent: latest.opponent?.trim() || null,
      homeAway: latest.home_away ?? null,
      startTime: latest.start_time,
      timeZone: latest.timezone ?? null,
    },
  };
}
