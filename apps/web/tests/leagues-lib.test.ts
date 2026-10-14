/**
 * Leagues' shared rules on the web (docs/specs/tournaments-and-leagues.md §5;
 * D17, D20, D21).
 */

import { describe, it, expect } from "vitest";
import {
  activeLeagues,
  leagueErrorMessage,
  leagueLabel,
  normalizeLeagueText,
} from "@/lib/leagues";

const league = (over: Record<string, unknown> = {}) => ({
  id: "l-1",
  team_id: "team-1",
  name: "Division 3",
  season: "Fall 2026",
  archived_at: null as string | null,
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  ...over,
});

describe("normalizeLeagueText", () => {
  it("trims the edges and collapses runs of spaces inside, as the database compares them (D21)", () => {
    expect(normalizeLeagueText("  Division   3 ")).toBe("Division 3");
    expect(normalizeLeagueText("Fall\t2026")).toBe("Fall 2026");
  });
});

describe("leagueLabel", () => {
  it("reads season then name: \"Fall 2026 Division 3\"", () => {
    expect(leagueLabel(league())).toBe("Fall 2026 Division 3");
  });
});

describe("activeLeagues", () => {
  it("leaves archived ones out (D17), and orders the rest by label", () => {
    const leagues = [
      league({ id: "b", name: "Rec", season: "Spring 2027" }),
      league({ id: "x", archived_at: "2026-09-01T00:00:00Z" }),
      league({ id: "a", name: "Division 3", season: "Fall 2026" }),
    ];

    expect(activeLeagues(leagues).map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("leagueErrorMessage", () => {
  it("names the database's refusals in words", () => {
    expect(leagueErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "There's already a league with that name and season."
    );
    expect(leagueErrorMessage({ code: "23503", message: "LEAGUE_HAS_GAMES: this league has games; archive it instead" })).toBe(
      "This league has games, so it can't be deleted. Archive it instead: that keeps its record."
    );
    expect(leagueErrorMessage({ message: "LEAGUE_TEAM_MISMATCH: a game can only be in its own team's league" })).toBe(
      "A game can only be in its own team's league."
    );
    expect(leagueErrorMessage({ message: "CLUB_CLOSED: this club is closed" })).toBe(
      "This club is closed, so its leagues can't be changed."
    );
  });

  it("passes anything else through", () => {
    expect(leagueErrorMessage({ message: "network down" })).toBe("network down");
  });
});
