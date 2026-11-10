/**
 * How a tournament reads on the web (docs/specs/tournaments-and-leagues.md §4).
 *
 *   - its dates: whole days in its zone, inclusive (D13). It's stored as
 *     midnight starting the first day to midnight ending the last, so the last
 *     day is the day before `end_time`.
 *   - its placement: the label when set, else "1st place", "2nd place"…
 *   - whether it's underway: started, not yet ended
 *   - the line under a game: "Surf Cup · Semifinal"
 *   - its record: teamRecord over its own games only
 */

import { describe, it, expect } from "vitest";
import {
  isTournament,
  isUnderway,
  placementText,
  recordCardTournament,
  remainingGames,
  tournamentDates,
  tournamentDayKeys,
  tournamentLine,
  tournamentRecord,
} from "@/lib/events/tournament";

const LA = "America/Los_Angeles";
// Fri Oct 11 – Sun Oct 13, 2030, Pacific: midnight Oct 11 to midnight Oct 14 (PDT, UTC−7).
const SURF_CUP = {
  event_type: "tournament",
  start_time: "2030-10-11T07:00:00.000Z",
  end_time: "2030-10-14T07:00:00.000Z",
  timezone: LA,
};

describe("tournamentDates", () => {
  it("names its first and last days, inclusive, in its zone", () => {
    expect(tournamentDates(SURF_CUP)).toBe("Fri, Oct 11 – Sun, Oct 13");
  });

  it("a one-day tournament is that day", () => {
    expect(tournamentDates({ ...SURF_CUP, end_time: "2030-10-12T07:00:00.000Z" })).toBe("Fri, Oct 11");
  });

  it("follows its own zone, not the viewer's", () => {
    // Midnight Oct 11 to midnight Oct 13 in Tokyo is still Oct 11 – Oct 12 there.
    const tokyo = { ...SURF_CUP, timezone: "Asia/Tokyo", start_time: "2030-10-10T15:00:00.000Z", end_time: "2030-10-12T15:00:00.000Z" };
    expect(tournamentDates(tokyo)).toBe("Fri, Oct 11 – Sat, Oct 12");
  });

  it("spans a change of clocks without losing a day", () => {
    // Sat Nov 2 – Sun Nov 3, 2030: Pacific falls back on Nov 3 (PDT → PST).
    expect(
      tournamentDates({ ...SURF_CUP, start_time: "2030-11-02T07:00:00.000Z", end_time: "2030-11-04T08:00:00.000Z" })
    ).toBe("Sat, Nov 2 – Sun, Nov 3");
  });
});

describe("tournamentDayKeys", () => {
  it("lists each of its days in the calendar's zone", () => {
    expect(tournamentDayKeys(SURF_CUP, LA)).toEqual(["2030-10-11", "2030-10-12", "2030-10-13"]);
  });

  it("across a change of clocks, and a month boundary", () => {
    expect(
      tournamentDayKeys({ ...SURF_CUP, start_time: "2030-10-31T07:00:00.000Z", end_time: "2030-11-04T08:00:00.000Z" }, LA)
    ).toEqual(["2030-10-31", "2030-11-01", "2030-11-02", "2030-11-03"]);
  });

  it("a one-day tournament is that day", () => {
    expect(tournamentDayKeys({ ...SURF_CUP, end_time: "2030-10-12T07:00:00.000Z" }, LA)).toEqual(["2030-10-11"]);
  });
});

describe("placementText", () => {
  it("is the label when there is one", () => {
    expect(placementText({ placement_rank: 1, placement_label: "Gold bracket champions" })).toBe("Gold bracket champions");
  });

  it("is an ordinal place otherwise", () => {
    expect(placementText({ placement_rank: 1, placement_label: null })).toBe("1st place");
    expect(placementText({ placement_rank: 2, placement_label: null })).toBe("2nd place");
    expect(placementText({ placement_rank: 3, placement_label: null })).toBe("3rd place");
    expect(placementText({ placement_rank: 4, placement_label: null })).toBe("4th place");
    expect(placementText({ placement_rank: 11, placement_label: null })).toBe("11th place");
    expect(placementText({ placement_rank: 22, placement_label: null })).toBe("22nd place");
  });

  it("is nothing until it's set", () => {
    expect(placementText({ placement_rank: null, placement_label: null })).toBeNull();
    expect(placementText({ placement_rank: null, placement_label: "  " })).toBeNull();
  });
});

describe("isUnderway", () => {
  it("from its start until its end", () => {
    expect(isUnderway(SURF_CUP, new Date("2030-10-12T20:00:00Z"))).toBe(true);
    expect(isUnderway(SURF_CUP, new Date("2030-10-10T20:00:00Z"))).toBe(false);
    expect(isUnderway(SURF_CUP, new Date("2030-10-14T07:00:00Z"))).toBe(false);
  });
});

describe("tournamentLine", () => {
  it("names the tournament, and the round when there is one", () => {
    expect(tournamentLine({ round: "Semifinal", tournament: { title: "Surf Cup" } })).toBe("Surf Cup · Semifinal");
    expect(tournamentLine({ round: null, tournament: { title: "Surf Cup" } })).toBe("Surf Cup");
  });

  it("is nothing for a game outside a tournament", () => {
    expect(tournamentLine({ round: null, tournament: null })).toBeNull();
  });
});

describe("isTournament", () => {
  it("by its type", () => {
    expect(isTournament(SURF_CUP)).toBe(true);
    expect(isTournament({ event_type: "game" })).toBe(false);
  });
});

describe("tournamentRecord", () => {
  const NOW = new Date("2030-10-20T00:00:00Z");
  const g = (id: string, result: string | null, tournament_id: string | null, start = "2030-10-12T17:00:00Z") => ({
    id,
    start_time: start,
    game_result: result,
    tournament_id,
    timezone: LA,
    opponent: "Rivals",
    home_away: "home",
    score_for: null,
    score_against: null,
  });

  it("counts only its own games with a result", () => {
    const record = tournamentRecord(
      "t-1",
      [g("a", "win", "t-1"), g("b", "loss", "t-1"), g("c", "win", "t-2"), g("d", "win", null), g("e", null, "t-1")],
      NOW
    );
    expect(record).toMatchObject({ wins: 1, losses: 1, ties: 0 });
  });

  it("is null before any of its games has a result", () => {
    expect(tournamentRecord("t-1", [g("a", null, "t-1"), g("b", "win", "t-2")], NOW)).toBeNull();
  });
});

// ── A tournament in progress (docs/specs/tournament-in-progress-record.md) ────

describe("recordCardTournament: which tournament the Record card shows", () => {
  const T = (id: string, start: string, end: string) => ({ ...SURF_CUP, id, title: id, start_time: start, end_time: end });
  // Surf Cup runs Fri Oct 11 – Sun Oct 13, 2030; Saturday noon, Pacific.
  const SAT_NOON = new Date("2030-10-12T19:00:00.000Z");
  const CUP = T("cup", SURF_CUP.start_time, SURF_CUP.end_time);
  const OLD = T("old", "2030-09-20T07:00:00.000Z", "2030-09-22T07:00:00.000Z");
  const win = (tournamentId: string | null, start = "2030-10-11T17:00:00.000Z") => ({
    id: `g-${start}`,
    start_time: start,
    game_result: "win",
    tournament_id: tournamentId,
  });

  it("with none underway, the latest finished one, as before", () => {
    expect(recordCardTournament([], OLD, [win("old", "2030-09-20T17:00:00.000Z")], SAT_NOON)).toEqual({
      tournament: OLD,
      current: false,
    });
  });

  it("one underway without a result yet leaves the latest finished one", () => {
    expect(recordCardTournament([CUP], OLD, [], SAT_NOON)).toEqual({ tournament: OLD, current: false });
    expect(recordCardTournament([CUP], null, [], SAT_NOON)).toBeNull();
  });

  it("one underway with a result replaces it, as current (Q9)", () => {
    expect(recordCardTournament([CUP], OLD, [win("cup")], SAT_NOON)).toEqual({ tournament: CUP, current: true });
  });

  it("a game outside the tournament doesn't make it current", () => {
    expect(recordCardTournament([CUP], OLD, [win(null)], SAT_NOON)?.current).toBe(false);
  });

  it("two underway with results: the one that started most recently", () => {
    const later = T("later", "2030-10-12T07:00:00.000Z", "2030-10-14T07:00:00.000Z");
    const games = [win("cup"), win("later", "2030-10-12T16:00:00.000Z")];
    expect(recordCardTournament([CUP, later], null, games, SAT_NOON)?.tournament).toBe(later);
    expect(recordCardTournament([later, CUP], null, games, SAT_NOON)?.tournament).toBe(later);
  });

  it("not before it starts, even with a result entered early", () => {
    const early = new Date("2030-10-11T06:59:00.000Z"); // a minute before midnight starting Friday
    expect(recordCardTournament([CUP], OLD, [win("cup", "2030-10-10T17:00:00.000Z")], early)?.current).toBe(false);
  });

  it("is current until midnight ending its last day in its zone, then it's left to the finished read", () => {
    const games = [win("cup")];
    expect(recordCardTournament([CUP], OLD, games, new Date("2030-10-14T06:59:00.000Z"))?.current).toBe(true);
    // At midnight it's no longer underway: the latest-finished read now returns it.
    expect(recordCardTournament([CUP], CUP, games, new Date("2030-10-14T07:00:00.000Z"))).toEqual({
      tournament: CUP,
      current: false,
    });
  });
});

describe("remainingGames", () => {
  const SAT_NOON = new Date("2030-10-12T19:00:00.000Z");
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

  it("lists games without a result, in start order", () => {
    const games = [
      game("final", "2030-10-13T22:00:00.000Z", { round: "Final", opponent: null }),
      game("semi", "2030-10-13T17:00:00.000Z", { round: "Semifinal", home_away: "away" }),
    ];
    expect(remainingGames(games, SAT_NOON)).toEqual([
      { id: "semi", startTime: "2030-10-13T17:00:00.000Z", timeZone: LA, opponent: "Rivals FC", homeAway: "away", round: "Semifinal", awaiting: false },
      { id: "final", startTime: "2030-10-13T22:00:00.000Z", timeZone: LA, opponent: null, homeAway: "home", round: "Final", awaiting: false },
    ]);
  });

  it("leaves out games with a result and cancelled games (Q4)", () => {
    const games = [
      game("played", "2030-10-11T17:00:00.000Z", { game_result: "win" }),
      game("off", "2030-10-13T17:00:00.000Z", { is_cancelled: true }),
      game("next", "2030-10-13T19:00:00.000Z"),
    ];
    expect(remainingGames(games, SAT_NOON).map((g) => g.id)).toEqual(["next"]);
  });

  it("a game that has started without a result is awaiting one (Q3)", () => {
    const games = [game("now", "2030-10-12T18:00:00.000Z"), game("later", "2030-10-12T21:00:00.000Z")];
    expect(remainingGames(games, SAT_NOON).map((g) => g.awaiting)).toEqual([true, false]);
  });

  it("a blank opponent or round is none", () => {
    expect(remainingGames([game("g", "2030-10-13T17:00:00.000Z", { opponent: "  ", round: " " })], SAT_NOON)[0]).toMatchObject({
      opponent: null,
      round: null,
    });
  });
});
