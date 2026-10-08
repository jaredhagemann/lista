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
