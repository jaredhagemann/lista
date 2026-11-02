// @vitest-environment jsdom
/**
 * BUG-040: a series edit names a zone as it stands on the event's date, not today
 * (docs/bugs/fixed/040-series-zone-label-uses-today.md).
 *
 * Both tests pin today to July, when Los Angeles is on PDT, and edit a December
 * series, which is on PST. Whatever the date the suite runs, the abbreviation
 * must come from the event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RRule } from "rrule";

const mocks = vi.hoisted(() => {
  const from = () => {
    const result = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { SeriesEditForm } from "@/components/calendar/series-edit-form";
import { seriesEditSummary } from "@/lib/events/series-summary";
import type { SeriesEditPlan } from "@/lib/events/series-edit";

const PACIFIC = "America/Los_Angeles";
const DENVER = "America/Denver";
const DAY = 24 * 60 * 60 * 1000;
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

// Thursdays at 4:00 PM Pacific: Dec 3, 10 and 17.
const FIRST = Date.parse("2026-12-04T00:00:00Z");

function occurrence(id: string, start: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    team_id: "team-1",
    title: "Practice",
    event_type: "practice",
    start_time: new Date(start).toISOString(),
    end_time: new Date(start + 90 * 60 * 1000).toISOString(),
    timezone: PACIFIC,
    is_cancelled: false,
    location_id: null,
    locations: null,
    arrival_time: null,
    notes: null,
    opponent: null,
    home_away: null,
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    recurrence_rule: null,
    parent_event_id: "head",
    tournament_id: null,
    league_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    reminder: null,
    created_by: "coach-1",
    created_at: null,
    ...extra,
  };
}

const SERIES = [
  occurrence("head", FIRST, {
    parent_event_id: null,
    recurrence_rule: "DTSTART;TZID=America/Los_Angeles:20261203T160000\nRRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261217T235959Z",
  }),
  occurrence("second", FIRST + 7 * DAY),
  occurrence("third", FIRST + 14 * DAY),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the zone's abbreviation in a series edit", () => {
  it("in the notice's summary, comes from the occurrences' dates", () => {
    const rule = new RRule({ freq: RRule.WEEKLY, byweekday: [RRule.TH], dtstart: new Date("2026-12-03T16:00:00Z") }).toString();
    const plan = {
      seriesHeadId: "head",
      newHeadId: "head",
      newHeadRule: rule,
      truncateRule: null,
      updates: [{ id: "head", start_time: "2026-12-03T23:00:00Z", end_time: "2026-12-04T00:30:00Z", fields: {} }],
      cancels: [],
      inserts: [],
      reparent: [],
      preview: { updated: [], cancelled: [], added: [], unchanged: [] },
    } as SeriesEditPlan;

    const rows = seriesEditSummary({
      plan,
      fields: {},
      anchor: { start_time: SERIES[0].start_time, end_time: SERIES[0].end_time },
      describe: (_key, value) => String(value),
      seriesZone: PACIFIC,
      newZone: DENVER,
      oldRule: rule,
      patternChanged: false,
    });

    expect(rows).toContainEqual({ field: "Time zone", before: "America/Los Angeles (PST)", after: "America/Denver (MST)" });
  });

  it("in the editor's review, comes from the occurrence the edit was opened on", async () => {
    // Dec 10 is missing, so the edit adds it, which is what opens the review.
    render(
      <SeriesEditForm
        series={[SERIES[0], SERIES[2]] as never}
        openedId="head"
        scope="series"
        teamId="team-1"
        fallbackTimeZone={PACIFIC}
        team={TEAM}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: DENVER } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Time zone: America/Los Angeles (PST) → America/Denver (MST)")).toBeTruthy();
  });
});
