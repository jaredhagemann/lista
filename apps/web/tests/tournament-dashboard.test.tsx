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
  /** Reads that fail (TL-026): "results", "leagues", "placed", "underway" or "remaining". */
  const failing = new Set<string>();
  const from = (table: string) => {
    const filters: string[] = [];
    const chain: Record<string, unknown> = {};
    // The dashboard reads events five ways: upcoming, games with a result, the
    // latest finished tournament, tournaments underway, and the remaining games
    // of one underway (docs/specs/tournament-in-progress-record.md).
    const kind = () => {
      if (table !== "events") return table;
      if (filters.includes("event_type=tournament")) return filters.includes("gt:end_time") ? "underway" : "placed";
      if (filters.includes("is:game_result")) return "remaining";
      if (filters.includes("not:game_result")) return "results";
      return "upcoming";
    };
    const data = () => (table !== "events" ? (tables[table] ?? null) : (tables[kind()] ?? []));
    const result = () =>
      failing.has(kind())
        ? Promise.resolve({ data: null, error: { message: "statement timeout" }, count: null })
        : Promise.resolve({ data: data(), error: null, count: 0 });
    for (const m of ["select", "neq", "in", "gte", "gt", "lte", "lt", "order", "limit", "is", "or"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (["gt", "lte", "is"].includes(m)) filters.push(`${m}:${String(args[0])}`);
        return chain;
      };
    }
    chain.eq = (column: string, value: unknown) => {
      calls.push({ table, method: "eq", args: [column, value] });
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

// ── A tournament in progress (docs/specs/tournament-in-progress-record.md) ───
//
// From its first result until it ends, the tournament underway takes the
// tournament section: "Current tournament" with "Now", its latest result, its
// record, and its remaining games. It replaces the last finished one (Q9).

describe("the Record card during a tournament", () => {
  // Saturday noon, Pacific: Surf Cup (Fri Dec 11 – Sun Dec 13) is underway.
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-12-12T20:00:00.000Z"));
  });

  const FALL_CLASSIC = { ...SURF_CUP, id: "t-old", title: "Fall Classic", start_time: "2026-11-06T08:00:00.000Z", end_time: "2026-11-09T08:00:00.000Z" };
  const scored = (id: string, start: string, result: string, tournamentId: string | null, opponent: string, sf: number, sa: number) => ({
    ...played(id, start, result, tournamentId, opponent),
    score_for: sf,
    score_against: sa,
  });
  const upcoming = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
    id,
    start_time: start,
    timezone: LA,
    opponent: "Eagles",
    home_away: "home",
    round: null,
    game_result: null,
    is_cancelled: false,
    tournament_id: "t-1",
    ...extra,
  });
  const current = () => within(screen.getByRole("region", { name: "Record" })).getByRole("region", { name: "Current tournament" });

  function surfCupUnderway() {
    mocks.tables.placed = [FALL_CLASSIC];
    mocks.tables.underway = [SURF_CUP];
    mocks.tables.results = [
      played("old", "2026-11-07T17:00:00Z", "loss", "t-old", "Owls"),
      scored("fri", "2026-12-11T17:00:00Z", "win", "t-1", "Rivals FC", 3, 1),
      scored("sat", "2026-12-12T17:00:00Z", "tie", "t-1", "Hawks", 2, 2),
    ];
    mocks.tables.remaining = [
      upcoming("final", "2026-12-13T22:00:00Z", { round: "Final", opponent: null }),
      upcoming("semi", "2026-12-13T17:00:00Z", { round: "Semifinal", home_away: "away" }),
    ];
  }

  it("shows the tournament from its first result: heading, Now, name and dates", async () => {
    surfCupUnderway();

    render(await DashboardPage());

    const section = current();
    expect(within(section).getByRole("heading", { name: /Current tournament/ })).toBeTruthy();
    expect(within(section).getByText("Now")).toBeTruthy();
    expect(within(section).getByText("Surf Cup")).toBeTruthy();
    expect(within(section).getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    // It replaces the last finished tournament (Q9).
    expect(screen.queryByText("Fall Classic")).toBeNull();
    expect(screen.queryByRole("region", { name: "Last tournament" })).toBeNull();
  });

  it("shows its latest result and its record so far", async () => {
    surfCupUnderway();

    render(await DashboardPage());

    const section = current();
    expect(within(section).getByText("Latest result")).toBeTruthy();
    const score = within(section).getByRole("table", { name: "Latest result score" });
    expect(within(score).getByText("vs Hawks")).toBeTruthy();
    expect(within(score).getAllByText("2")).toHaveLength(2);
    expect(within(section).getByText("Tournament Record")).toBeTruthy();
    expect(within(section).getByRole("img").getAttribute("aria-label")).toBe("1 win, 0 losses, 1 tie");
  });

  it("lists the remaining games in start order, each linking to its game (Q7)", async () => {
    surfCupUnderway();

    render(await DashboardPage());

    const list = within(current()).getByRole("list", { name: "Remaining games" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/dashboard/schedule/semi", "/dashboard/schedule/final"]);
    expect(within(links[0]).getByText("Semifinal · at Eagles")).toBeTruthy();
    expect(within(links[0]).getByText("Sun, Dec 13, 9:00 AM PST")).toBeTruthy();
    expect(within(links[1]).getByText("Final · Opponent TBD")).toBeTruthy();
  });

  it("a game that has started without a result reads Awaiting result (Q3)", async () => {
    surfCupUnderway();
    mocks.tables.remaining = [upcoming("now", "2026-12-12T19:00:00Z", { opponent: "Lions" })];

    render(await DashboardPage());

    const list = within(current()).getByRole("list", { name: "Remaining games" });
    expect(within(list).getByText("vs Lions")).toBeTruthy();
    expect(within(list).getByText("Awaiting result")).toBeTruthy();
    expect(within(list).queryByText(/AM|PM/)).toBeNull();
  });

  it("with every game played, no remaining list and no message (Q5)", async () => {
    surfCupUnderway();
    mocks.tables.remaining = [];

    render(await DashboardPage());

    expect(within(current()).queryByRole("list", { name: "Remaining games" })).toBeNull();
    expect(within(current()).queryByText(/Remaining games/)).toBeNull();
  });

  it("without leagues, the latest result shows once, not again as the last game (Q2)", async () => {
    surfCupUnderway();

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).queryByText("Last game")).toBeNull();
    expect(within(card).getAllByText("vs Hawks")).toHaveLength(1);
  });

  it("a later game outside the tournament still shows as the last game (Q2)", async () => {
    surfCupUnderway();
    mocks.tables.results = [...(mocks.tables.results as unknown[]), played("league", "2026-12-12T19:00:00Z", "win", null, "Bears")];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText("Last game")).toBeTruthy();
    expect(within(card).getByText("vs Bears")).toBeTruthy();
    expect(within(current()).getByText("vs Hawks")).toBeTruthy();
  });

  it("with leagues, each league keeps its own last game, and the tournament sits before Overall", async () => {
    surfCupUnderway();
    mocks.tables.leagues = [{ id: "div3", team_id: "team-1", name: "Division 3", season: "Fall 2026", archived_at: null }];
    mocks.tables.results = [
      ...(mocks.tables.results as Record<string, unknown>[]),
      { ...played("lg", "2026-12-05T17:00:00Z", "win", null, "Bears"), league_id: "div3" },
    ];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    const div3 = within(card).getByRole("region", { name: "Fall 2026 Division 3" });
    expect(within(div3).getByText("vs Bears")).toBeTruthy();
    const overall = within(card).getByRole("region", { name: "Overall record" });
    expect(div3.compareDocumentPosition(current()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(current().compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("underway with no result yet: the last finished tournament stays, and remaining games aren't read", async () => {
    mocks.tables.placed = [FALL_CLASSIC];
    mocks.tables.underway = [SURF_CUP];
    mocks.tables.results = [played("old", "2026-11-07T17:00:00Z", "loss", "t-old", "Owls")];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(within(card).getByRole("region", { name: "Last tournament" })).getByText("Fall Classic")).toBeTruthy();
    expect(within(card).queryByRole("region", { name: "Current tournament" })).toBeNull();
    expect(mocks.calls.some((c) => c.method === "is" && c.args[0] === "game_result")).toBe(false);
  });

  it("the card shows when the only result is in the tournament underway", async () => {
    mocks.tables.placed = [];
    mocks.tables.underway = [SURF_CUP];
    mocks.tables.results = [played("fri", "2026-12-11T17:00:00Z", "win", "t-1")];
    mocks.tables.remaining = [];

    render(await DashboardPage());

    expect(current()).toBeTruthy();
  });

  it("asks for the team's uncancelled tournaments underway, and that one's games without a result", async () => {
    surfCupUnderway();

    render(await DashboardPage());

    const now = "2026-12-12T20:00:00.000Z";
    const has = (method: string, ...args: unknown[]) =>
      mocks.calls.some((c) => c.table === "events" && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
    expect(has("lte", "start_time", now)).toBe(true);
    expect(has("gt", "end_time", now)).toBe(true);
    expect(has("eq", "tournament_id", "t-1")).toBe(true);
    expect(has("eq", "event_type", "game")).toBe(true);
    expect(has("is", "game_result", null)).toBe(true);
    expect(has("eq", "is_cancelled", false)).toBe(true);
    expect(has("order", "start_time", { ascending: true })).toBe(true);
  });

  it("the underway read failing: the card says it couldn't load (TL-026)", async () => {
    surfCupUnderway();
    mocks.failing.add("underway");

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText(/Couldn't load the record/)).toBeTruthy();
    expect(within(card).queryByText("Fall Classic")).toBeNull();
  });

  it("the remaining games read failing: the same, not a section without them", async () => {
    surfCupUnderway();
    mocks.failing.add("remaining");

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(card).getByText(/Couldn't load the record/)).toBeTruthy();
    expect(within(card).queryByRole("region", { name: "Current tournament" })).toBeNull();
  });

  it("once it ends it's the last tournament again, as before (D8)", async () => {
    vi.setSystemTime(new Date("2026-12-14T09:00:00.000Z"));
    mocks.tables.placed = [SURF_CUP];
    mocks.tables.underway = [];
    mocks.tables.results = [played("fri", "2026-12-11T17:00:00Z", "win", "t-1")];

    render(await DashboardPage());

    const card = screen.getByRole("region", { name: "Record" });
    expect(within(within(card).getByRole("region", { name: "Last tournament" })).getByText("Surf Cup")).toBeTruthy();
    expect(within(card).queryByText("Now")).toBeNull();
    expect(within(card).queryByRole("list", { name: "Remaining games" })).toBeNull();
    expect(within(card).getByText("Last game")).toBeTruthy();
  });
});
