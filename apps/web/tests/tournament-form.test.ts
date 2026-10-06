/**
 * Managing a tournament: its dates, its games, and what the database says back
 * (docs/specs/tournaments-and-leagues.md §4, part 2b).
 *
 *   - a tournament is whole days in its zone (D13): midnight starting its first
 *     day to midnight ending its last, across daylight saving
 *   - the form warns about games outside the tournament's days, but saves them:
 *     schedules slip
 *   - a game created with a tournament is stored with a title that reads on its
 *     own, for the installed 1.0.12, which shows the stored title
 *   - the database's refusals read as sentences
 */

import { describe, it, expect } from "vitest";
import {
  gamesOutsideDays,
  isWithinDays,
  tournamentBounds,
  tournamentDays,
  tournamentErrorMessage,
  tournamentGamesPayload,
  tournamentGameTitle,
} from "@/lib/events/tournament-form";

const LA = "America/Los_Angeles";
const DENVER = "America/Denver";

describe("tournamentBounds", () => {
  it("is midnight starting the first day to midnight ending the last, in the zone", () => {
    expect(tournamentBounds("2026-12-11", "2026-12-13", LA)).toEqual({
      start_time: "2026-12-11T08:00:00.000Z",
      end_time: "2026-12-14T08:00:00.000Z",
    });
  });

  it("keeps local midnight across daylight saving", () => {
    // Clocks fall back in Denver on Sunday Nov 1, 2026: MDT (−6) to MST (−7).
    expect(tournamentBounds("2026-10-31", "2026-11-01", DENVER)).toEqual({
      start_time: "2026-10-31T06:00:00.000Z",
      end_time: "2026-11-02T07:00:00.000Z",
    });
  });

  it("a one-day tournament ends at midnight that night", () => {
    expect(tournamentBounds("2026-12-12", "2026-12-12", LA)).toEqual({
      start_time: "2026-12-12T08:00:00.000Z",
      end_time: "2026-12-13T08:00:00.000Z",
    });
  });
});

describe("tournamentDays", () => {
  it("reads the first and last day back in the tournament's own zone", () => {
    const surfCup = { start_time: "2026-12-11T08:00:00.000Z", end_time: "2026-12-14T08:00:00.000Z", timezone: LA };
    expect(tournamentDays(surfCup, "Asia/Tokyo")).toEqual({ firstDay: "2026-12-11", lastDay: "2026-12-13" });
  });

  it("falls back to the team's zone for a tournament without one", () => {
    const fall = { start_time: "2026-10-31T06:00:00.000Z", end_time: "2026-11-02T07:00:00.000Z", timezone: null };
    expect(tournamentDays(fall, DENVER)).toEqual({ firstDay: "2026-10-31", lastDay: "2026-11-01" });
  });
});

describe("games outside the tournament's days", () => {
  it("a game on any of its days is within them, in the tournament's zone", () => {
    // 11 PM Sunday in Los Angeles is Monday in UTC, and still the tournament.
    expect(isWithinDays("2026-12-14T07:00:00.000Z", "2026-12-11", "2026-12-13", LA)).toBe(true);
    expect(isWithinDays("2026-12-11T08:00:00.000Z", "2026-12-11", "2026-12-13", LA)).toBe(true);
  });

  it("a game the day before or after is outside them", () => {
    expect(isWithinDays("2026-12-11T07:59:00.000Z", "2026-12-11", "2026-12-13", LA)).toBe(false);
    expect(isWithinDays("2026-12-14T08:00:00.000Z", "2026-12-11", "2026-12-13", LA)).toBe(false);
  });

  it("lists the games a change of dates leaves outside, cancelled ones aside", () => {
    const games = [
      { id: "fri", start_time: "2026-12-11T17:00:00.000Z", is_cancelled: false },
      { id: "sat", start_time: "2026-12-12T17:00:00.000Z", is_cancelled: false },
      { id: "sun", start_time: "2026-12-13T17:00:00.000Z", is_cancelled: false },
      { id: "sun-off", start_time: "2026-12-13T19:00:00.000Z", is_cancelled: true },
    ];
    // Moved to Saturday alone.
    expect(gamesOutsideDays(games, "2026-12-12", "2026-12-12", LA).map((g) => g.id)).toEqual(["fri", "sun"]);
    expect(gamesOutsideDays(games, "2026-12-11", "2026-12-13", LA)).toEqual([]);
  });
});

describe("a tournament game's stored title", () => {
  it("names the team and opponent, as the game reads everywhere", () => {
    expect(tournamentGameTitle({ opponent: "Rivals FC", home_away: "home", round: "Pool A" }, "U10 Girls")).toBe(
      "U10 Girls vs Rivals FC"
    );
    expect(tournamentGameTitle({ opponent: "Eagles", home_away: "away", round: null }, "U10 Girls")).toBe(
      "U10 Girls @ Eagles"
    );
  });

  it("is its round while the opponent isn't known yet, else Game", () => {
    expect(tournamentGameTitle({ opponent: " ", home_away: null, round: "Final" }, "U10 Girls")).toBe("Final");
    expect(tournamentGameTitle({ opponent: null, home_away: null, round: null }, "U10 Girls")).toBe("Game");
  });
});

describe("tournamentGamesPayload", () => {
  it("reads each game's times in the tournament's zone, and keeps only what's set", () => {
    const payload = tournamentGamesPayload(
      [
        { start: "2026-12-11T09:00", end: "2026-12-11T10:30", opponent: "Rivals FC", homeAway: "home", uniform: "home", round: "Pool A" },
        { start: "2026-12-13T14:00", end: "2026-12-13T15:30", opponent: "", homeAway: "", uniform: "", round: " Final " },
      ],
      LA,
      "U10 Girls"
    );

    expect(payload).toEqual([
      {
        title: "U10 Girls vs Rivals FC",
        start_time: "2026-12-11T17:00:00.000Z",
        end_time: "2026-12-11T18:30:00.000Z",
        opponent: "Rivals FC",
        home_away: "home",
        uniform: "home",
        round: "Pool A",
      },
      {
        title: "Final",
        start_time: "2026-12-13T22:00:00.000Z",
        end_time: "2026-12-13T23:30:00.000Z",
        opponent: null,
        home_away: null,
        uniform: null,
        round: "Final",
      },
    ]);
  });
});

describe("tournamentErrorMessage", () => {
  it("turns the database's codes into sentences", () => {
    expect(tournamentErrorMessage({ message: "INVALID_TOURNAMENT_DAYS: the last day is before the first" })).toBe(
      "The last day can't be before the first."
    );
    expect(tournamentErrorMessage({ message: "NOT_AUTHORIZED" })).toBe("Only a coach or manager can do that.");
    expect(tournamentErrorMessage({ message: "ALREADY_CANCELLED" })).toBe("This tournament is already cancelled.");
    expect(tournamentErrorMessage({ message: "TOURNAMENT_NOT_FOUND" })).toBe(
      "This tournament no longer exists. Refresh to see the schedule."
    );
  });

  it("passes anything else through", () => {
    expect(tournamentErrorMessage({ message: "network down" })).toBe("network down");
  });
});
