/**
 * The schedule's order around Today (review TL-021,
 * docs/reviews/2026-10-01-tournaments-and-leagues-review.md).
 *
 * An underway tournament belongs with today's events, but its start was days
 * ago. Putting Today before it, while keeping the order by start time, put
 * everything that happened since it started (yesterday's practice) below Today.
 * Now each event is placed by the day it's shown on: an underway tournament's
 * is today, anything else's is its start.
 */

import { buildScheduleItems } from "../lib/schedule-items";

const DAY = 24 * 60 * 60 * 1000;
// Sunday afternoon, local time.
const NOW = new Date(2099, 11, 13, 15, 0, 0);
const at = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 60 * 60 * 1000).toISOString();

function ev(id: string, overrides: Record<string, unknown> = {}) {
  return { id, event_type: "practice", start_time: at(0), end_time: at(0, 1), is_cancelled: false, ...overrides };
}

const order = (events: ReturnType<typeof ev>[]) =>
  buildScheduleItems(events, NOW).items.map((i) => (i.type === "today-divider" ? "TODAY" : i.event.id));

// Friday to Monday: underway on Sunday.
const SURF_CUP = ev("surf-cup", { event_type: "tournament", start_time: at(-2.6), end_time: at(1) });

describe("an underway tournament", () => {
  it("sits under Today, with the events since its start that are past above it", () => {
    const events = [
      SURF_CUP,
      ev("saturday-practice", { start_time: at(-1), end_time: at(-1, 1) }),
      ev("tuesday-game", { event_type: "game", start_time: at(2), end_time: at(2, 1) }),
    ];

    expect(order(events)).toEqual(["saturday-practice", "TODAY", "surf-cup", "tuesday-game"]);
  });

  it("is where the schedule opens", () => {
    const events = [SURF_CUP, ev("saturday-practice", { start_time: at(-1), end_time: at(-1, 1) })];
    const { items, firstUpcomingIndex } = buildScheduleItems(events, NOW);

    expect(items[firstUpcomingIndex]).toMatchObject({ type: "event", event: { id: "surf-cup" } });
  });

  it("two at once both sit under Today, in the order they started", () => {
    const events = [
      SURF_CUP,
      ev("winter-cup", { event_type: "tournament", start_time: at(-1.6), end_time: at(2) }),
      ev("saturday-practice", { start_time: at(-1), end_time: at(-1, 1) }),
    ];

    expect(order(events)).toEqual(["saturday-practice", "TODAY", "surf-cup", "winter-cup"]);
  });

  it("a cancelled one stays at its start, as it's shown without Now", () => {
    const events = [
      { ...SURF_CUP, is_cancelled: true },
      ev("saturday-practice", { start_time: at(-1), end_time: at(-1, 1) }),
      ev("tuesday-game", { start_time: at(2), end_time: at(2, 1) }),
    ];

    expect(order(events)).toEqual(["surf-cup", "saturday-practice", "TODAY", "tuesday-game"]);
  });
});

describe("as before, without one", () => {
  it("past events, Today, then the rest", () => {
    const events = [
      ev("friday", { start_time: at(-2), end_time: at(-2, 1) }),
      ev("this-evening", { start_time: at(0, 3), end_time: at(0, 4) }),
    ];

    expect(order(events)).toEqual(["friday", "TODAY", "this-evening"]);
  });

  it("all past: Today goes last", () => {
    expect(order([ev("friday", { start_time: at(-2), end_time: at(-2, 1) })])).toEqual(["friday", "TODAY"]);
  });
});
