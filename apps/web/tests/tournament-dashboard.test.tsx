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
  /** Reads that fail (TL-026): "results", "leagues" or "placed". */
  const failing = new Set<string>();
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
    const kind = () =>
      table === "leagues"
        ? "leagues"
        : table !== "events"
          ? table
          : filters.includes("event_type=tournament")
            ? "placed"
            : filters.includes("not:game_result")
              ? "results"
              : "upcoming";
    const result = () =>
      failing.has(kind())
        ? Promise.resolve({ data: null, error: { message: "statement timeout" }, count: null })
        : Promise.resolve({ data: data(), error: null, count: 0 });
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
    failing,
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
  mocks.failing.clear();
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
    expect(within(card).getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    // Its own record as a graphic, as a league section shows one (2026-10-14).
    const tournament = within(card).getByRole("region", { name: "Last tournament" });
    expect(within(tournament).getByRole("heading", { name: "Last tournament" })).toBeTruthy();
    expect(within(tournament).getByRole("img").getAttribute("aria-label")).toBe("2 wins, 1 loss, 0 ties");
    // A heading above the graphic (2026-10-14).
    expect(within(tournament).getByText("Tournament Record")).toBeTruthy();
    // The season's record still counts every game, under "Overall Record".
    const overall = within(card).getByRole("region", { name: "Overall record" });
    expect(within(overall).getByRole("heading", { name: "Overall Record" })).toBeTruthy();
    expect(within(overall).getByRole("img").getAttribute("aria-label")).toBe("3 wins, 1 loss, 0 ties");
  });

  // D8 revised 2026-10-14: the latest finished tournament always shows, under
  // the last game, until a newer one finishes.
  it("a game since then shows as the last game, and the tournament stays", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.results = [
      played("b", "2026-12-12T17:00:00Z", "win", "t-1"),
      played("e", "2026-12-18T17:00:00Z", "tie", null, "Hawks"),
    ];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("Last game")).toBeTruthy();
    expect(within(card).getByText("vs Hawks")).toBeTruthy();
    expect(within(within(card).getByRole("region", { name: "Last tournament" })).getByText("Surf Cup")).toBeTruthy();
  });

  it("a finished tournament without a placement shows its results too", async () => {
    mocks.tables.placed = [{ ...SURF_CUP, placement_rank: null, placement_label: null }];
    mocks.tables.results = [played("b", "2026-12-12T17:00:00Z", "win", "t-1")];

    render(await DashboardPage());

    const tournament = within(screen.getByRole("region", { name: "Record" })).getByRole("region", { name: "Last tournament" });
    expect(within(tournament).getByText("Surf Cup")).toBeTruthy();
    expect(within(tournament).getByRole("img").getAttribute("aria-label")).toBe("1 win, 0 losses, 0 ties");
    expect(within(tournament).queryByText(/place$/)).toBeNull();
  });

  it("asks for the latest finished tournament, placed or not", async () => {
    mocks.tables.placed = [];
    mocks.tables.results = [];

    render(await DashboardPage());

    // No placement filter: an unplaced tournament's results count too.
    expect(mocks.calls.some((c) => c.table === "events" && c.method === "or")).toBe(false);
  });

  it("lays out the last game, then the last tournament, then the overall record across the card", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.results = [
      played("b", "2026-12-12T17:00:00Z", "win", "t-1"),
      played("e", "2026-12-18T17:00:00Z", "tie", null, "Hawks"),
    ];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    const lastGame = within(card).getByText("Last game");
    const tournament = within(card).getByRole("region", { name: "Last tournament" });
    const overall = within(card).getByRole("region", { name: "Overall record" });
    expect(lastGame.compareDocumentPosition(tournament) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tournament.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(overall).getByRole("img").getAttribute("aria-label")).toBe("1 win, 0 losses, 1 tie");
    // Full width: not one column of two.
    expect(overall.querySelector(".sm\\:grid-cols-2")).toBeNull();
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
    // No wins, losses and ties to show yet: no graphic, for it or overall.
    expect(within(card).queryByRole("img")).toBeNull();
  });

  it("without a placed tournament, the last game as before", async () => {
    mocks.tables.placed = [];
    mocks.tables.results = [played("a", "2026-12-12T17:00:00Z", "win", "t-1")];

    render(await DashboardPage());

    expect(within(screen.getByRole("region", { name: "Record" })).getByText("Last game")).toBeTruthy();
  });
});

// ── League sections (docs/specs/tournaments-and-leagues.md §5, D9; layout 2026-10-14) ──
//
// With active leagues, the card leads with a section per league, its last game
// and its own record graphic, and ends with the Overall record. A league with no
// result yet says so. A placed tournament (D8) shows in Overall. Without leagues
// the card is as before.

describe("the Record card with leagues (D9)", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-12-20T12:00:00.000Z"));
  });

  const leagueGame = (id: string, start: string, result: string, league: string | null, opponent = "Rivals FC") => ({
    ...played(id, start, result, null, opponent),
    league_id: league,
  });
  const DIV3 = { id: "div3", team_id: "team-1", name: "Division 3", season: "Fall 2026", archived_at: null };
  const CUP = { id: "cup", team_id: "team-1", name: "Cup", season: "Fall 2026", archived_at: null };
  const RESULTS = [
    leagueGame("a", "2026-10-03T17:00:00Z", "win", "div3"),
    leagueGame("b", "2026-10-10T17:00:00Z", "win", "div3"),
    leagueGame("c", "2026-10-17T17:00:00Z", "loss", "div3", "Eagles"),
    leagueGame("d", "2026-10-24T17:00:00Z", "tie", null, "Hawks"),
  ];
  const section = (card: HTMLElement, name: string) => within(card).getByRole("region", { name });

  it("leads with a section per league: its last game and its own record", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = RESULTS;

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    const div3 = section(card, "Fall 2026 Division 3");
    expect(within(div3).getByText("Last game")).toBeTruthy();
    // Its own last game: the loss to Eagles, not the overall last (a tie with Hawks).
    expect(within(div3).getByText("vs Eagles")).toBeTruthy();
    expect(within(div3).getByRole("img").getAttribute("aria-label")).toBe("2 wins, 1 loss, 0 ties");
    // A heading above the graphic (2026-10-14).
    expect(within(div3).getByText("League Record")).toBeTruthy();
  });

  it("ends with the Overall record, counting every game (D3)", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = RESULTS;

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    const overall = section(card, "Overall record");
    expect(within(overall).getByRole("img").getAttribute("aria-label")).toBe("2 wins, 1 loss, 1 tie");
    expect(within(overall).queryByText("Last game")).toBeNull();
    // Always last.
    const div3 = section(card, "Fall 2026 Division 3");
    expect(div3.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a section for each active league, and one with no result yet says so", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3, CUP];
    mocks.tables.results = RESULTS;

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(section(card, "Fall 2026 Division 3")).getByText("Last game")).toBeTruthy();
    const cup = section(card, "Fall 2026 Cup");
    expect(within(cup).getByText("No results yet")).toBeTruthy();
    expect(within(cup).queryByRole("img")).toBeNull();
  });

  it("the last tournament sits between the leagues and the Overall record", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = [leagueGame("a", "2026-12-15T17:00:00Z", "win", "div3")];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    const div3 = section(card, "Fall 2026 Division 3");
    const tournament = section(card, "Last tournament");
    const overall = section(card, "Overall record");
    expect(within(tournament).getByText("Surf Cup")).toBeTruthy();
    expect(div3.compareDocumentPosition(tournament) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tournament.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(overall).queryByText("Surf Cup")).toBeNull();
  });

  // Decided 2026-10-15 (review of #126): an active league alone shows the card.
  it("an active league with no result yet shows the card, before any game or tournament", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = [];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(section(card, "Fall 2026 Division 3")).getByText("No results yet")).toBeTruthy();
    // Nothing to count overall yet.
    expect(within(card).queryByRole("region", { name: "Overall record" })).toBeNull();
    expect(within(card).queryByRole("img")).toBeNull();
  });

  it("with no league, result or tournament, there's no card", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [];
    mocks.tables.results = [];

    render(await DashboardPage());

    expect(screen.queryByRole("region", { name: "Record" })).toBeNull();
  });

  it("asks for active leagues only (D17); with none, the card has no league sections", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [];
    mocks.tables.results = [leagueGame("a", "2026-10-03T17:00:00Z", "win", null)];

    render(await DashboardPage());

    const archivedFilter = mocks.calls.find((c) => c.table === "leagues" && c.method === "is");
    expect(archivedFilter?.args).toEqual(["archived_at", null]);
    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByRole("region", { name: "Overall record" })).toBeTruthy();
    expect(within(card).getByText("Last game")).toBeTruthy();
  });
});

// ── TL-026 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ───────

describe("TL-026: a failed read is never shown as no results", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-12-20T12:00:00.000Z"));
  });
  const DIV3 = { id: "div3", team_id: "team-1", name: "Division 3", season: "Fall 2026", archived_at: null };

  it("the results failing: the card says it couldn't load, not \"No results yet\"", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = [{ ...played("a", "2026-10-03T17:00:00Z", "win", null), league_id: "div3" }];
    mocks.failing.add("results");

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText(/Couldn't load the record/)).toBeTruthy();
    expect(within(card).queryByText("No results yet")).toBeNull();
    expect(within(card).queryByRole("region", { name: "Overall record" })).toBeNull();
  });

  it("the leagues failing: the same, not a card without its leagues", async () => {
    mocks.tables.placed = [];
    mocks.tables.results = [{ ...played("a", "2026-10-03T17:00:00Z", "win", null), league_id: "div3" }];
    mocks.failing.add("leagues");

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText(/Couldn't load the record/)).toBeTruthy();
    expect(within(card).queryByText("Last game")).toBeNull();
  });

  it("the last tournament failing: the same", async () => {
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.leagues = [];
    mocks.tables.results = [played("a", "2026-12-12T17:00:00Z", "win", "t-1")];
    mocks.failing.add("placed");

    render(await DashboardPage());

    expect(within(screen.getByRole("region", { name: "Record" })).getByText(/Couldn't load the record/)).toBeTruthy();
  });

  it("a successful empty read still shows an active league's \"No results yet\"", async () => {
    mocks.tables.placed = [];
    mocks.tables.leagues = [DIV3];
    mocks.tables.results = [];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("No results yet")).toBeTruthy();
    expect(within(card).queryByText(/Couldn't load/)).toBeNull();
  });
});
