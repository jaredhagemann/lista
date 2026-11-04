// @vitest-environment jsdom

/**
 * The Club Overview page: one agenda card for the week, and a one-column list of
 * teams with their overall records.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const VIEWER = "viewer-1";

const mocks = vi.hoisted(() => {
  type Result = { rows: unknown[]; error: unknown };
  const tables: Record<string, Result> = {};
  const pagesRead: Record<string, number> = {};

  const from = (table: string) => {
    let name = table;
    const chain: Record<string, unknown> = {};
    const whole = () => {
      const t = tables[name] ?? { rows: [], error: null };
      return { data: t.error ? null : t.rows, error: t.error };
    };
    for (const m of ["eq", "in", "is", "not", "gt", "lt", "gte", "lte", "order"]) chain[m] = () => chain;
    chain.select = (columns: string) => {
      // The events table is read twice: the week's events, and the results.
      if (table === "events") name = columns.includes("game_result") ? "results" : "events";
      return chain;
    };
    chain.range = (start: number, end: number) => {
      pagesRead[name] = (pagesRead[name] ?? 0) + 1;
      const t = tables[name] ?? { rows: [], error: null };
      // A server caps a page at 1000 rows, whatever was asked for.
      const size = Math.min(end - start + 1, 1000);
      return Promise.resolve({ data: t.error ? null : t.rows.slice(start, start + size), error: t.error });
    };
    chain.maybeSingle = () => {
      const { data, error } = whole();
      return Promise.resolve({ data: data?.[0] ?? null, error });
    };
    chain.single = chain.maybeSingle;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(whole()).then(res, rej);
    return chain;
  };

  return {
    tables,
    pagesRead,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "viewer-1" } } }) } },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/active-context", () => ({
  loadActiveContext: async () => ({ activeMembership: { team_id: "u10" } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import ClubOverviewPage from "@/app/dashboard/club/page";

const LA = "America/Los_Angeles";

function setTable(name: string, rows: unknown[], error: unknown = null) {
  mocks.tables[name] = { rows, error };
}

function agendaEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
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

function result(teamId: string, game_result: string, id = `${teamId}-${game_result}-${Math.random()}`) {
  return { id, team_id: teamId, start_time: "2026-10-01T18:00:00Z", timezone: LA, game_result };
}

async function renderPage() {
  render(await ClubOverviewPage());
}

const teamRow = (name: string) => screen.getByRole("listitem", { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T18:00:00Z"));
  for (const k of Object.keys(mocks.tables)) delete mocks.tables[k];
  for (const k of Object.keys(mocks.pagesRead)) delete mocks.pagesRead[k];
  setTable("teams", [
    { id: "u10", name: "10U Girls", timezone: LA, organization_id: "org-1" },
    { id: "u8", name: "8U Girls", timezone: LA, organization_id: "org-1" },
  ]);
  setTable("organizations", [{ name: "SLOFC", plan: "club_small", brand_color_secondary: "#112233" }]);
  setTable("profile_managers", []);
  setTable("team_members", [{ team_id: "u10", profile_id: VIEWER }]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the top of the page", () => {
  it("no longer shows the team and member counts", async () => {
    await renderPage();

    expect(screen.queryByText("Active Teams")).toBeNull();
    expect(screen.queryByText("Total Members")).toBeNull();
    expect(screen.queryByText("Events This Week")).toBeNull();
  });
});

describe("the Events this week card", () => {
  it("lists each event with its day, time, team and title", async () => {
    setTable("events", [
      agendaEvent(),
      agendaEvent({
        id: "e-2",
        team_id: "u8",
        event_type: "game",
        opponent: "Santa Maria FC",
        home_away: "home",
        start_time: "2026-11-06T01:00:00Z",
        end_time: "2026-11-06T02:00:00Z",
      }),
    ]);

    await renderPage();

    const card = within(screen.getByRole("region", { name: "Events this week" }));
    expect(card.getByText("Wed, Nov 4", { exact: false })).toBeTruthy();
    expect(card.getByText("Thu, Nov 5")).toBeTruthy();
    expect(card.getByText("4:00 PM – 5:30 PM PST")).toBeTruthy();
    expect(card.getByText("10U Girls")).toBeTruthy();
    expect(card.getByText("Practice")).toBeTruthy();
    expect(card.getByText("8U Girls")).toBeTruthy();
    expect(card.getByText("vs Santa Maria FC")).toBeTruthy();
  });

  it("marks a cancelled event", async () => {
    setTable("events", [agendaEvent({ is_cancelled: true })]);

    await renderPage();

    expect(screen.getByText("Practice").className).toContain("line-through");
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("says when there's nothing this week", async () => {
    setTable("events", []);

    await renderPage();

    expect(screen.getByText("No events in the next 7 days.")).toBeTruthy();
  });

  it("says so when the events couldn't be read, instead of showing an empty week", async () => {
    setTable("events", [], new Error("down"));

    await renderPage();

    expect(screen.getByText("Couldn't load events. Refresh the page to try again.")).toBeTruthy();
    expect(screen.queryByText("No events in the next 7 days.")).toBeNull();
  });

  it("links an event on a team the viewer is on, and not one on a team they aren't", async () => {
    setTable("events", [agendaEvent(), agendaEvent({ id: "e-2", team_id: "u8", title: "Other practice" })]);

    await renderPage();

    expect(screen.getByRole("link", { name: /Practice/ }).getAttribute("href")).toBe("/dashboard/schedule/e-1");
    expect(screen.queryByRole("link", { name: /Other practice/ })).toBeNull();
    expect(screen.getByText("Other practice")).toBeTruthy();
  });

  it("links an event on a team where the viewer manages a player", async () => {
    setTable("profile_managers", [{ managed_id: "child-1" }]);
    setTable("team_members", [
      { team_id: "u10", profile_id: VIEWER },
      { team_id: "u8", profile_id: "child-1" },
    ]);
    setTable("events", [agendaEvent({ id: "e-2", team_id: "u8", title: "Other practice" })]);

    await renderPage();

    expect(screen.getByRole("link", { name: /Other practice/ })).toBeTruthy();
  });
});

describe("the Teams section", () => {
  it("lists teams in number order, in one column", async () => {
    await renderPage();

    const list = screen.getByRole("list", { name: "Teams" });
    expect(list.className).not.toContain("grid-cols-2");
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      "8U Girls",
      "10U Girls",
    ]);
  });

  it("shows each team's overall record, counted per team", async () => {
    setTable("results", [
      result("u10", "win"),
      result("u10", "win"),
      result("u10", "loss"),
      result("u10", "tie"),
      result("u8", "loss"),
    ]);

    await renderPage();

    expect(within(teamRow("10U Girls")).getByRole("img", { name: "2 wins, 1 loss, 1 tie" })).toBeTruthy();
    expect(within(teamRow("8U Girls")).getByRole("img", { name: "0 wins, 1 loss, 0 ties" })).toBeTruthy();
  });

  it("colors wins in the club's secondary color", async () => {
    setTable("results", [result("u10", "win")]);

    await renderPage();

    const bar = within(teamRow("10U Girls")).getByRole("img");
    expect((bar.firstElementChild as HTMLElement).style.backgroundColor).toBe("rgb(17, 34, 51)");
  });

  it("says when a team has no results yet", async () => {
    setTable("results", [result("u10", "win")]);

    await renderPage();

    expect(within(teamRow("8U Girls")).getByText("No results yet")).toBeTruthy();
  });

  it("counts every game when a club has more than one page of results", async () => {
    setTable("results", Array.from({ length: 2300 }, (_, i) => result("u10", "win", `g-${i}`)));

    await renderPage();

    expect(within(teamRow("10U Girls")).getByRole("img", { name: "2300 wins, 0 losses, 0 ties" })).toBeTruthy();
    expect(mocks.pagesRead.results).toBeGreaterThan(1);
  });

  it("says so when the results couldn't be read, instead of No results yet", async () => {
    setTable("results", [], new Error("down"));

    await renderPage();

    expect(within(teamRow("10U Girls")).getByText("Couldn't load record")).toBeTruthy();
    expect(screen.queryByText("No results yet")).toBeNull();
  });
});
