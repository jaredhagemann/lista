// @vitest-environment jsdom
/**
 * Tournaments on the dashboard (docs/specs/tournaments-and-leagues.md §4).
 *
 *   - Upcoming lists a tournament while it's upcoming or underway: it's asked
 *     for by end time, not start time, and shows its dates, with "Now" while
 *     it runs.
 *   - After a tournament with a placement, the Record card's last result is the
 *     tournament: "Surf Cup · 2nd place", with its own record and dates, until
 *     a newer game (D8). The overall record is unchanged (D3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    const filters: string[] = [];
    const chain: Record<string, unknown> = {};
    // The dashboard reads events three ways: upcoming, games with a result, and
    // the latest tournament with a placement.
    const data = () => {
      if (table !== "events") return tables[table] ?? null;
      if (filters.includes("event_type=tournament")) return tables.placed ?? [];
      if (filters.includes("not:game_result")) return tables.results ?? [];
      return tables.upcoming ?? [];
    };
    const result = () => Promise.resolve({ data: data(), error: null, count: 0 });
    for (const m of ["select", "neq", "in", "gte", "gt", "lte", "lt", "order", "limit", "is", "or"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return chain;
      };
    }
    chain.eq = (column: string, value: unknown) => {
      filters.push(`${column}=${String(value)}`);
      return chain;
    };
    chain.not = (column: string) => {
      filters.push(`not:${column}`);
      return chain;
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown) => result().then(res);
    return chain;
  };
  return {
    tables,
    calls,
    membership: null as unknown,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) } },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/get-active-membership", () => ({ getActiveMembership: async () => mocks.membership }));
vi.mock("@/components/team/create-team-form", () => ({ CreateTeamForm: () => null }));

import DashboardPage from "@/app/dashboard/page";

const LA = "America/Los_Angeles";
const TEAM = { id: "team-1", name: "12U Girls", season: null, logo_url: null, timezone: LA, organization_id: null };

// Fri Dec 11 – Sun Dec 13, 2026, Pacific.
const SURF_CUP = {
  id: "t-1",
  team_id: "team-1",
  title: "Surf Cup",
  event_type: "tournament",
  start_time: "2026-12-11T08:00:00.000Z",
  end_time: "2026-12-14T08:00:00.000Z",
  timezone: LA,
  is_cancelled: false,
  opponent: null,
  home_away: null,
  uniform: null,
  score_for: null,
  score_against: null,
  placement_rank: 2,
  placement_label: null,
  locations: null,
};

function played(id: string, start: string, result: string, tournamentId: string | null, opponent = "Rivals FC") {
  return { id, start_time: start, timezone: LA, opponent, home_away: "home", game_result: result, score_for: null, score_against: null, tournament_id: tournamentId };
}

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.calls.length = 0;
  mocks.membership = { team_id: "team-1", role: "coach", profile_id: "coach-1", teams: TEAM };
  mocks.tables.team_members = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-12T20:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Upcoming", () => {
  it("asks for events by end time, so an underway tournament stays listed", async () => {
    mocks.tables.upcoming = [SURF_CUP];

    render(await DashboardPage());

    const byEnd = mocks.calls.find((c) => c.table === "events" && c.method === "gt");
    expect(byEnd?.args[0]).toBe("end_time");
    expect(mocks.calls.some((c) => c.table === "events" && c.method === "gte" && c.args[0] === "start_time")).toBe(false);
  });

  it("shows a tournament's dates, and Now while it runs", async () => {
    mocks.tables.upcoming = [SURF_CUP];

    render(await DashboardPage());

    const item = screen.getByRole("link", { name: /Surf Cup/ });
    expect(within(item).getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    expect(within(item).getByText("Now")).toBeTruthy();
    expect(within(item).queryByText(/AM|PM/)).toBeNull();
  });
});

describe("the Record card after a tournament (D8)", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-12-20T12:00:00.000Z"));
  });

  it("shows the tournament as the last result: its placement, its own record and its dates", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.results = [
      played("a", "2026-11-28T17:00:00Z", "win", null),
      played("b", "2026-12-11T17:00:00Z", "win", "t-1"),
      played("c", "2026-12-12T17:00:00Z", "win", "t-1"),
      played("d", "2026-12-13T17:00:00Z", "loss", "t-1"),
    ];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("Last tournament")).toBeTruthy();
    expect(within(card).getByText("Surf Cup")).toBeTruthy();
    expect(within(card).getByText("2nd place")).toBeTruthy();
    expect(within(card).getByLabelText("Tournament record").textContent).toBe("2–1–0");
    expect(within(card).getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    // The season's record still counts every game.
    expect(within(card).getByRole("img").getAttribute("aria-label")).toBe("3 wins, 1 loss, 0 ties");
  });

  it("a game since then is the last result again", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.results = [
      played("b", "2026-12-12T17:00:00Z", "win", "t-1"),
      played("e", "2026-12-18T17:00:00Z", "tie", null, "Hawks"),
    ];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("Last game")).toBeTruthy();
    expect(within(card).queryByText("Last tournament")).toBeNull();
    expect(within(card).getByText("vs Hawks")).toBeTruthy();
  });

  // TL-022 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md): a
  // placement is recorded on its own, whether or not any game has a result.
  it("a placed tournament with no game results still shows, without a record", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.results = [];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("Last tournament")).toBeTruthy();
    expect(within(card).getByText("2nd place")).toBeTruthy();
    expect(within(card).queryByLabelText("Tournament record")).toBeNull();
    // No wins, losses and ties to show yet.
    expect(within(card).queryByRole("img")).toBeNull();
  });

  it("without a placed tournament, the last game as before", async () => {
    mocks.tables.placed = [];
    mocks.tables.results = [played("a", "2026-12-12T17:00:00Z", "win", "t-1")];

    render(await DashboardPage());

    expect(within(screen.getByRole("region", { name: "Record" })).getByText("Last game")).toBeTruthy();
  });
});
