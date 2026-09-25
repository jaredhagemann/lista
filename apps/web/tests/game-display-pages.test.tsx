// @vitest-environment jsdom
/**
 * The pages that hand a team's name and uniforms to the game views
 * (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * Page-level, not component-level: the event page used to read the team through
 * a mistaken cast (`activeMembership.teams` treated as a membership, then
 * `.teams` again), so every team field it passed was null — uniform names never
 * reached the event page's edit form, nor did the team timezone added for
 * BUG-010. Component tests given the right props could not have caught that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "order", "limit", "is"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
    membership: null as unknown,
    eventDetailProps: null as Record<string, unknown> | null,
    client: {
      from,
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/get-active-membership", () => ({ getActiveMembership: async () => mocks.membership }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/calendar/event-detail", () => ({
  EventDetail: (props: Record<string, unknown>) => {
    mocks.eventDetailProps = props;
    return null;
  },
}));
vi.mock("@/components/team/create-team-form", () => ({ CreateTeamForm: () => null }));

import EventDetailPage from "@/app/dashboard/schedule/[eventId]/page";
import DashboardPage from "@/app/dashboard/page";

const TEAM_ROW = {
  id: "team-1",
  name: "U10 Girls",
  season: "Fall 2026",
  home_uniform: "Navy",
  away_uniform: "White",
  home_uniform_color: "#1e3a8a",
  away_uniform_color: "#ffffff",
  timezone: "America/Los_Angeles",
  organization_id: "org-1",
};

const GAME = {
  id: "evt-1",
  team_id: "team-1",
  title: "Saturday game",
  event_type: "game",
  start_time: "2026-12-12T17:00:00+00:00",
  end_time: "2026-12-12T18:30:00+00:00",
  timezone: "America/Los_Angeles",
  is_cancelled: false,
  opponent: "Rivals FC",
  home_away: "away",
  uniform: "home",
  score_for: null,
  score_against: null,
  profiles: { first_name: "Coach", last_name: "Casey" },
  locations: { name: "Islay Park" },
};

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.eventDetailProps = null;
  mocks.membership = { team_id: "team-1", role: "coach", profile_id: "coach-1", teams: TEAM_ROW };
});

afterEach(cleanup);

describe("the event page", () => {
  it("hands the event view the team's name, uniform names and colors, and timezone", async () => {
    mocks.tables.events = GAME;
    mocks.tables.availability = [];
    mocks.tables.team_members = [];

    const page = await EventDetailPage({
      params: Promise.resolve({ eventId: "evt-1" }),
      searchParams: Promise.resolve({}),
    });
    render(page);

    expect(mocks.eventDetailProps?.team).toEqual({
      name: "U10 Girls",
      home_uniform: "Navy",
      away_uniform: "White",
      home_uniform_color: "#1e3a8a",
      away_uniform_color: "#ffffff",
    });
    expect(mocks.eventDetailProps?.teamTimeZone).toBe("America/Los_Angeles");
  });
});

describe("the dashboard", () => {
  it("names upcoming games by team and opponent, with their uniform", async () => {
    mocks.tables.events = [
      GAME,
      { ...GAME, id: "evt-2", event_type: "practice", title: "Evening practice", opponent: null, uniform: null },
    ];

    render(await DashboardPage());

    expect(screen.getByText("U10 Girls @ Rivals FC")).toBeTruthy();
    expect(screen.getByText("Evening practice")).toBeTruthy();
    expect(screen.getByLabelText("Uniform: Navy").style.backgroundColor).toBe("rgb(30, 58, 138)");
  });
});
