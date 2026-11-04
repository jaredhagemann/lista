/**
 * The Club Overview's agenda: every team's events for today and the next 6 days,
 * grouped by day like Google Calendar's Schedule view.
 */

import { describe, it, expect } from "vitest";
import { buildAgenda, type AgendaEvent } from "@/lib/club/agenda";

// Wednesday, November 4, 2026, 10:00 AM in Los Angeles.
const NOW = new Date("2026-11-04T18:00:00Z");
const LA = "America/Los_Angeles";

const TEAMS = [
  { id: "u8", name: "8U Girls", timezone: LA },
  { id: "u10", name: "10U Girls", timezone: LA },
  { id: "ny", name: "NY Team", timezone: "America/New_York" },
];

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id: "e1",
    team_id: "u10",
    title: "Practice",
    event_type: "practice",
    opponent: null,
    home_away: null,
    score_for: null,
    score_against: null,
    start_time: "2026-11-05T00:00:00Z",
    end_time: "2026-11-05T01:30:00Z",
    timezone: LA,
    is_cancelled: false,
    round: null,
    tournament: null,
    ...overrides,
  };
}

const build = (events: AgendaEvent[], homeZone: string | null = LA) =>
  buildAgenda(events, TEAMS, { now: NOW, homeZone });

describe("which events are listed", () => {
  it("keeps an event from earlier today that has already ended", () => {
    const days = build([event({ start_time: "2026-11-04T15:00:00Z", end_time: "2026-11-04T16:00:00Z" })]);

    expect(days).toHaveLength(1);
    expect(days[0].items[0].event.id).toBe("e1");
  });

  it("leaves out yesterday's events", () => {
    expect(build([event({ start_time: "2026-11-04T04:00:00Z", end_time: "2026-11-04T05:00:00Z" })])).toEqual([]);
  });

  it("includes the sixth day from today and leaves out the seventh", () => {
    const days = build([
      event({ id: "last", start_time: "2026-11-10T20:00:00Z", end_time: "2026-11-10T21:00:00Z" }),
      event({ id: "over", start_time: "2026-11-11T20:00:00Z", end_time: "2026-11-11T21:00:00Z" }),
    ]);

    expect(days.flatMap((d) => d.items.map((i) => i.event.id))).toEqual(["last"]);
  });

  it("keeps cancelled events", () => {
    const days = build([event({ is_cancelled: true })]);

    expect(days[0].items[0].event.is_cancelled).toBe(true);
  });

  it("leaves out an event of a team that isn't listed", () => {
    expect(build([event({ team_id: "another-club" })])).toEqual([]);
  });
});

describe("days", () => {
  it("skips days with no events, and marks today", () => {
    const days = build([
      event({ id: "today", start_time: "2026-11-04T23:00:00Z", end_time: "2026-11-05T00:00:00Z" }),
      event({ id: "later", start_time: "2026-11-07T20:00:00Z", end_time: "2026-11-07T21:00:00Z" }),
    ]);

    expect(days.map((d) => d.heading)).toEqual(["Today · Wed, Nov 4", "Sat, Nov 7"]);
  });

  it("puts an evening event on its own local day, not the server's UTC day", () => {
    // 11 PM Wednesday in Los Angeles is already Thursday in UTC.
    const days = build([event({ start_time: "2026-11-05T07:00:00Z", end_time: "2026-11-05T08:00:00Z" })]);

    expect(days[0].heading).toBe("Today · Wed, Nov 4");
  });

  it("puts an event on the day in its own zone, whatever the home team's", () => {
    // 1 AM Thursday in New York, still Wednesday in Los Angeles.
    const days = build([
      event({ team_id: "ny", timezone: "America/New_York", start_time: "2026-11-05T06:00:00Z", end_time: "2026-11-05T07:00:00Z" }),
    ]);

    expect(days[0].heading).toBe("Thu, Nov 5");
  });

  it("falls back to the team's zone when the event has none", () => {
    const days = build([event({ timezone: null, start_time: "2026-11-05T07:00:00Z", end_time: "2026-11-05T08:00:00Z" })]);

    expect(days[0].heading).toBe("Today · Wed, Nov 4");
    expect(days[0].items[0].time).toContain("PST");
  });

  it("reads today in UTC when the home team has no usable zone", () => {
    const days = build([event({ timezone: "UTC", start_time: "2026-11-04T20:00:00Z", end_time: "2026-11-04T21:00:00Z" })], null);

    expect(days[0].heading).toBe("Today · Wed, Nov 4");
  });
});

describe("a row", () => {
  it("shows the team, the title and a labeled time range", () => {
    const [item] = build([event()])[0].items;

    expect(item.teamName).toBe("10U Girls");
    expect(item.title).toBe("Practice");
    expect(item.time).toBe("4:00 PM – 5:30 PM PST");
  });

  it("doesn't repeat the team's name in a game's title", () => {
    const days = build([
      event({ id: "home", event_type: "game", opponent: "Santa Maria FC", home_away: "home" }),
      event({ id: "away", event_type: "game", opponent: "Arroyo Grande", home_away: "away" }),
    ]);

    expect(days[0].items.map((i) => i.title)).toEqual(["@ Arroyo Grande", "vs Santa Maria FC"]);
  });

  it("shows a game's score once it has one", () => {
    const [item] = build([
      event({ event_type: "game", opponent: "Santa Maria FC", home_away: "home", score_for: 2, score_against: 1 }),
    ])[0].items;

    expect(item.title).toBe("vs Santa Maria FC · 2–1");
  });

  it("names a tournament game's tournament and round", () => {
    const [item] = build([
      event({ event_type: "game", opponent: "Rivals", tournament: { title: "Surf Cup" }, round: "Semifinal" }),
    ])[0].items;

    expect(item.partOf).toBe("Surf Cup · Semifinal");
  });
});

describe("order within a day", () => {
  it("is by start time, then team in number order", () => {
    const days = build([
      event({ id: "later", team_id: "u8", start_time: "2026-11-05T02:00:00Z", end_time: "2026-11-05T03:00:00Z" }),
      event({ id: "ten", team_id: "u10" }),
      event({ id: "eight", team_id: "u8" }),
    ]);

    expect(days[0].items.map((i) => i.event.id)).toEqual(["eight", "ten", "later"]);
  });

  it("puts a tournament first, since it has no time of day", () => {
    const days = build([
      event({ id: "morning", start_time: "2026-11-05T16:00:00Z", end_time: "2026-11-05T17:00:00Z" }),
      event({
        id: "cup",
        event_type: "tournament",
        title: "Surf Cup",
        start_time: "2026-11-05T22:00:00Z",
        end_time: "2026-11-07T08:00:00Z",
      }),
    ]);

    expect(days[0].items.map((i) => i.event.id)).toEqual(["cup", "morning"]);
  });
});

describe("a tournament spanning days", () => {
  const cup = (start: string, end: string) =>
    event({ id: "cup", event_type: "tournament", title: "Surf Cup", start_time: start, end_time: end });

  it("appears once, on its first day, showing its dates instead of a time", () => {
    // Friday through Sunday, midnight to midnight in Los Angeles.
    const days = build([cup("2026-11-06T08:00:00Z", "2026-11-09T08:00:00Z")]);

    expect(days).toHaveLength(1);
    expect(days[0].heading).toBe("Fri, Nov 6");
    expect(days[0].items[0].time).toBe("Fri, Nov 6 – Sun, Nov 8");
  });

  it("appears today when it's already underway", () => {
    const days = build([cup("2026-11-03T08:00:00Z", "2026-11-06T07:00:00Z")]);

    expect(days[0].heading).toBe("Today · Wed, Nov 4");
    expect(days[0].items[0].time).toBe("Tue, Nov 3 – Thu, Nov 5");
  });

  it("is gone once its last day has passed", () => {
    // Ends at midnight starting today, so yesterday was its last day.
    expect(build([cup("2026-11-01T07:00:00Z", "2026-11-04T08:00:00Z")])).toEqual([]);
  });

  it("lists its games under their own days as well", () => {
    const days = build([
      cup("2026-11-06T08:00:00Z", "2026-11-09T08:00:00Z"),
      event({ id: "sat", event_type: "game", opponent: "Rivals", start_time: "2026-11-07T18:00:00Z", end_time: "2026-11-07T19:00:00Z" }),
    ]);

    expect(days.map((d) => d.heading)).toEqual(["Fri, Nov 6", "Sat, Nov 7"]);
    expect(days[1].items[0].event.id).toBe("sat");
  });
});
