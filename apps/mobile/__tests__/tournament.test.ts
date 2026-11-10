/**
 * Tournament rules on the phone: the web's, copied (docs/specs/tournaments-and-
 * leagues.md §4, §8 "Rules (web and phone, the same cases)").
 *
 * The phone's zone is pinned to Tokyo (jest.config.js), which is no
 * tournament's zone: a date read in the phone's zone instead of the
 * tournament's shows up as a wrong day.
 */

import {
  isTournament,
  isUnderway,
  placementText,
  recordCardTournament,
  remainingGames,
  tournamentDates,
  tournamentLine,
  tournamentRecord,
} from "../lib/tournament";
import { effectiveAnswer } from "../lib/availability";

const LA = "America/Los_Angeles";

// Fri Dec 11 – Sun Dec 13, 2026, Pacific: midnight to midnight.
const SURF_CUP = { start_time: "2026-12-11T08:00:00.000Z", end_time: "2026-12-14T08:00:00.000Z", timezone: LA };

describe("tournamentDates", () => {
  it("is its first and last day, in its own zone", () => {
    expect(tournamentDates(SURF_CUP)).toBe("Fri, Dec 11 – Sun, Dec 13");
  });

  it("is one date for a one-day tournament", () => {
    expect(tournamentDates({ ...SURF_CUP, end_time: "2026-12-12T08:00:00.000Z" })).toBe("Fri, Dec 11");
  });

  it("keeps whole days across daylight saving", () => {
    // Denver falls back on Sunday Nov 1, 2026.
    const fall = { start_time: "2026-10-31T06:00:00.000Z", end_time: "2026-11-02T07:00:00.000Z", timezone: "America/Denver" };
    expect(tournamentDates(fall)).toBe("Sat, Oct 31 – Sun, Nov 1");
  });

  it("falls back to the team's zone for a tournament without its own", () => {
    expect(tournamentDates({ ...SURF_CUP, timezone: null, teams: { timezone: LA } })).toBe("Fri, Dec 11 – Sun, Dec 13");
  });
});

describe("isTournament and isUnderway", () => {
  it("knows a tournament by its type", () => {
    expect(isTournament({ event_type: "tournament" })).toBe(true);
    expect(isTournament({ event_type: "game" })).toBe(false);
  });

  it("is underway from its start until its end", () => {
    expect(isUnderway(SURF_CUP, new Date("2026-12-12T20:00:00.000Z"))).toBe(true);
    expect(isUnderway(SURF_CUP, new Date("2026-12-11T07:59:00.000Z"))).toBe(false);
    expect(isUnderway(SURF_CUP, new Date("2026-12-14T08:00:00.000Z"))).toBe(false);
  });
});

describe("placementText", () => {
  it("the label wins, else an ordinal, else nothing", () => {
    expect(placementText({ placement_rank: 2, placement_label: "Silver bracket champions" })).toBe("Silver bracket champions");
    expect(placementText({ placement_rank: 1 })).toBe("1st place");
    expect(placementText({ placement_rank: 2 })).toBe("2nd place");
    expect(placementText({ placement_rank: 3 })).toBe("3rd place");
    expect(placementText({ placement_rank: 11 })).toBe("11th place");
    expect(placementText({ placement_rank: 22 })).toBe("22nd place");
    expect(placementText({})).toBeNull();
  });
});

describe("tournamentLine", () => {
  it("names the tournament, and the round when there is one", () => {
    expect(tournamentLine({ round: "Semifinal", tournament: { title: "Surf Cup" } })).toBe("Surf Cup · Semifinal");
    expect(tournamentLine({ round: " ", tournament: { title: "Surf Cup" } })).toBe("Surf Cup");
    expect(tournamentLine({ round: "Semifinal", tournament: null })).toBeNull();
  });
});

describe("tournamentRecord", () => {
  it("counts only this tournament's games with a result", () => {
    const games = [
      { tournament_id: "t-1", start_time: "2026-12-11T17:00:00.000Z", game_result: "win" },
      { tournament_id: "t-1", start_time: "2026-12-12T17:00:00.000Z", game_result: "loss" },
      { tournament_id: "t-1", start_time: "2026-12-13T17:00:00.000Z", game_result: null },
      { tournament_id: null, start_time: "2026-12-05T17:00:00.000Z", game_result: "win" },
    ];
    const record = tournamentRecord("t-1", games, new Date("2026-12-20T00:00:00.000Z"));
    expect(record).toMatchObject({ wins: 1, losses: 1, ties: 0 });
    expect(tournamentRecord("t-2", games, new Date("2026-12-20T00:00:00.000Z"))).toBeNull();
  });
});

describe("effectiveAnswer", () => {
  it("a game's own answer wins, else the tournament's, else none", () => {
    expect(effectiveAnswer("maybe", "available")).toEqual({ status: "maybe", inherited: false });
    expect(effectiveAnswer(null, "available")).toEqual({ status: "available", inherited: true });
    expect(effectiveAnswer(undefined, undefined)).toEqual({ status: null, inherited: false });
  });

  it("clearing the game's answer falls back to the tournament's", () => {
    const own: "unavailable" | null = null;
    expect(effectiveAnswer(own, "available").status).toBe("available");
  });
});

// ── A tournament in progress (docs/specs/tournament-in-progress-record.md) ────

describe("recordCardTournament: which tournament the Record card shows", () => {
  const T = (id: string, start: string, end: string) => ({ ...SURF_CUP, id, start_time: start, end_time: end });
  // Saturday noon, Pacific.
  const SAT_NOON = new Date("2026-12-12T20:00:00.000Z");
  const CUP = T("cup", SURF_CUP.start_time, SURF_CUP.end_time);
  const OLD = T("old", "2026-11-06T08:00:00.000Z", "2026-11-09T08:00:00.000Z");
  const win = (tournamentId: string | null, start = "2026-12-11T17:00:00.000Z") => ({
    id: `g-${start}`,
    start_time: start,
    game_result: "win",
    tournament_id: tournamentId,
  });

  it("with none underway, the latest finished one, as before", () => {
    expect(recordCardTournament([], OLD, [], SAT_NOON)).toEqual({ tournament: OLD, current: false });
  });

  it("one underway without a result yet leaves the latest finished one", () => {
    expect(recordCardTournament([CUP], OLD, [], SAT_NOON)).toEqual({ tournament: OLD, current: false });
    expect(recordCardTournament([CUP], null, [win(null)], SAT_NOON)).toBeNull();
  });

  it("one underway with a result replaces it, as current (Q9)", () => {
    expect(recordCardTournament([CUP], OLD, [win("cup")], SAT_NOON)).toEqual({ tournament: CUP, current: true });
  });

  it("two underway with results: the one that started most recently", () => {
    const later = T("later", "2026-12-12T08:00:00.000Z", "2026-12-14T08:00:00.000Z");
    const games = [win("cup"), win("later", "2026-12-12T17:00:00.000Z")];
    expect(recordCardTournament([CUP, later], null, games, SAT_NOON)?.tournament).toBe(later);
  });

  it("not before it starts, and not once it ends", () => {
    expect(recordCardTournament([CUP], OLD, [win("cup", "2026-12-10T17:00:00.000Z")], new Date("2026-12-11T07:59:00.000Z"))?.current).toBe(false);
    expect(recordCardTournament([CUP], OLD, [win("cup")], new Date("2026-12-14T07:59:00.000Z"))?.current).toBe(true);
    expect(recordCardTournament([CUP], OLD, [win("cup")], new Date("2026-12-14T08:00:00.000Z"))?.current).toBe(false);
  });
});

describe("remainingGames", () => {
  const SAT_NOON = new Date("2026-12-12T20:00:00.000Z");
  const game = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
    id,
    start_time: start,
    timezone: LA,
    opponent: "Rivals FC",
    home_away: "home",
    round: null,
    game_result: null,
    is_cancelled: false,
    ...extra,
  });

  it("lists games without a result, cancelled ones left out, in start order (Q4)", () => {
    const games = [
      game("final", "2026-12-13T22:00:00.000Z", { round: "Final", opponent: " " }),
      game("played", "2026-12-11T17:00:00.000Z", { game_result: "win" }),
      game("off", "2026-12-13T19:00:00.000Z", { is_cancelled: true }),
      game("semi", "2026-12-13T17:00:00.000Z", { round: "Semifinal", home_away: "away" }),
    ];
    expect(remainingGames(games, SAT_NOON)).toEqual([
      { id: "semi", startTime: "2026-12-13T17:00:00.000Z", timeZone: LA, opponent: "Rivals FC", homeAway: "away", round: "Semifinal", awaiting: false },
      { id: "final", startTime: "2026-12-13T22:00:00.000Z", timeZone: LA, opponent: null, homeAway: "home", round: "Final", awaiting: false },
    ]);
  });

  it("a game that has started without a result is awaiting one (Q3)", () => {
    expect(remainingGames([game("now", "2026-12-12T19:00:00.000Z")], SAT_NOON)[0].awaiting).toBe(true);
  });
});
