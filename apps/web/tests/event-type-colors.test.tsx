// @vitest-environment jsdom
/**
 * One color per event type, on every page (2026-10-08): practice blue, game
 * green, tournament purple, other yellow.
 *
 * Tournaments were amber on the schedule and calendar, but purple in the
 * availability grid (no entry there, so they fell back to "other"), and had no
 * color at all on their own page. Each page kept its own map. Now they share
 * one, and nothing else defines a type's color.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { render, cleanup, waitFor } from "@testing-library/react";
import { EVENT_TYPE_STYLES, eventTypeStyle } from "@/lib/events/type-colors";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchResponsesForEvents: vi.fn(),
  fetchTeamRoster: vi.fn(),
}));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
}));
vi.mock("@/lib/availability/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability/queries")>()),
  fetchResponsesForEvents: mocks.fetchResponsesForEvents,
  fetchTeamRoster: mocks.fetchTeamRoster,
}));
vi.mock("@/lib/supabase/client", () => {
  const result = () => Promise.resolve({ data: [], error: null, count: 0 });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
  chain.single = result;
  chain.maybeSingle = result;
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
  const client = {
    from: () => chain,
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
  return { createClient: () => client };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
import { EventDetail } from "@/components/calendar/event-detail";

afterEach(cleanup);

describe("the colors", () => {
  it("tournament is purple, other is yellow", () => {
    for (const value of Object.values(EVENT_TYPE_STYLES.tournament)) expect(value).toMatch(/purple/);
    for (const value of Object.values(EVENT_TYPE_STYLES.other)) expect(value).toMatch(/yellow/);
  });

  it("practice is blue and game is green, as before", () => {
    for (const value of Object.values(EVENT_TYPE_STYLES.practice)) expect(value).toMatch(/blue/);
    for (const value of Object.values(EVENT_TYPE_STYLES.game)) expect(value).toMatch(/green/);
  });

  it("no type is amber, which is Maybe's", () => {
    for (const style of Object.values(EVENT_TYPE_STYLES)) {
      for (const value of Object.values(style)) expect(value).not.toMatch(/amber/);
    }
  });

  it("an unknown type is shown as other", () => {
    expect(eventTypeStyle("scrimmage")).toBe(EVENT_TYPE_STYLES.other);
  });
});

describe("one place for them", () => {
  // Every page's type color comes from lib/events/type-colors.ts. A purple or
  // yellow anywhere else is a type color defined twice, the cause of the drift.
  it("no other source file uses purple or yellow", () => {
    const root = path.resolve(__dirname, "../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith(path.join("events", "type-colors.ts"))) {
          if (/\b(?:bg|text|border)-(?:purple|yellow)-\d/.test(fs.readFileSync(full, "utf8"))) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("as pages render them", () => {
  const TEAM = "11111111-1111-1111-1111-111111111111";
  const at = (id: string, type: string) => ({
    id,
    team_id: TEAM,
    title: type,
    event_type: type,
    tournament_id: null,
    start_time: "2099-01-05T18:00:00.000Z",
    end_time: "2099-01-05T19:00:00.000Z",
    is_cancelled: false,
  });

  it("the availability grid labels a tournament purple and other yellow", async () => {
    mocks.fetchEventPage.mockResolvedValue({
      items: [
        at("aaaaaaaa-0000-0000-0000-000000000001", "tournament"),
        at("aaaaaaaa-0000-0000-0000-000000000002", "other"),
      ],
      nextCursor: null,
      hasNext: false,
    });
    mocks.fetchResponsesForEvents.mockResolvedValue([]);
    mocks.fetchTeamRoster.mockResolvedValue([]);
    const { getByText } = render(<AvailabilityMatrix teamId={TEAM} currentUserId="me" isAdmin={false} timeZone="UTC" />);

    await waitFor(() => expect(getByText("Tournament").className).toMatch(/purple/));
    expect(getByText("Other").className).toMatch(/yellow/);
  });

  it("an event page's badge is its type's color, a tournament's included", () => {
    const event = {
      id: "t-1",
      team_id: "team-1",
      title: "Surf Cup",
      event_type: "tournament",
      start_time: "2099-12-11T08:00:00.000Z",
      end_time: "2099-12-14T08:00:00.000Z",
      timezone: "America/Los_Angeles",
      is_cancelled: false,
      locations: null,
      tournament: null,
      tournament_id: null,
      recurrence_rule: null,
      parent_event_id: null,
      arrival_time: null,
      placement_rank: null,
      placement_label: null,
    };
    const { getByText } = render(
      <EventDetail
        event={event as never}
        isAdmin={false}
        creatorName="Coach"
        team={{ name: "U10 Girls" }}
        currentUserId="me"
        availabilityRows={[]}
        members={[]}
      />
    );

    expect(getByText("Tournament").className).toMatch(/purple/);
  });
});
