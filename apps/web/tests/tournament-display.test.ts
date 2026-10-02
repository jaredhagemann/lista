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
