/**
 * Leagues on the phone (docs/specs/tournaments-and-leagues.md §5; D8, D9, D11;
 * leagues part 3). Display only: leagues are made and tagged on the web.
 *
 *   - the Record card, as the web's (D8/D9 revised 2026-10-14 and 2026-10-15):
 *     a section per active league (its last game and "League Record", or "No
 *     results yet"), else the team's last game; then the latest finished
 *     tournament with "Tournament Record"; then "Overall Record", always last.
 *     An active league alone shows the card
 *   - a league tag on league games, on home and the schedule
 *   - a game's screen names its league, and labels Home / Away
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import { leagueLabel, leagueRecords } from "../lib/leagues";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockFilters: { table: string; method: string; column: string; value: unknown }[] = [];
/** Reads that fail, as "table:column=value" (TL-026), e.g. the results read "events:event_type=game". */
const mockFailing = new Set<string>();
/** Reads held until their promise resolves, keyed as mockFailing is (TL-027). */
const mockGates = new Map<string, Promise<void>>();

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const eqs: string[] = [];
    const keep = (method: string, column: string, value: unknown, test: (row: Row) => boolean) => {
      mockFilters.push({ table, method, column, value });
      if (method === "eq") eqs.push(`${column}=${String(value)}`);
      filters.push((row) => !(column in row) || test(row));
      return chain;
    };
    const at = (v: unknown) => Date.parse(String(v));
    const result = () => {
      const gate = eqs.map((e) => mockGates.get(`${table}:${e}`)).find(Boolean);
      return gate ? gate.then(read) : read();
    };
    const read = (): Promise<{ data: Row[] | null; error: { message: string } | null; count: number | null }> => {
      if (eqs.some((e) => mockFailing.has(`${table}:${e}`))) {
        return Promise.resolve({ data: null, error: { message: "statement timeout" }, count: null });
      }
      const data = (mockTables[table] ?? []).filter((row) => filters.every((f) => f(row))).map((r) => ({ ...r }));
      return Promise.resolve({ data, error: null, count: data.length });
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => keep("eq", c, v, (r) => r[c] === v),
      is: (c: string, v: unknown) => keep("is", c, v, (r) => (r[c] ?? null) === v),
      in: (c: string, v: unknown[]) => keep("in", c, v, (r) => v.includes(r[c])),
      gt: (c: string, v: unknown) => keep("gt", c, v, (r) => at(r[c]) > at(v)),
      gte: (c: string, v: unknown) => keep("gte", c, v, (r) => at(r[c]) >= at(v)),
      lt: (c: string, v: unknown) => keep("lt", c, v, (r) => at(r[c]) < at(v)),
      lte: (c: string, v: unknown) => keep("lte", c, v, (r) => at(r[c]) <= at(v)),
      not: (c: string) => keep("not", c, null, (r) => r[c] != null),
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => result().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    chain.maybeSingle = chain.single;
    return chain;
  };
  return { supabase: { from } };
});

let mockEventId = "g-league";
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    useLocalSearchParams: () => ({ eventId: mockEventId }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, []),
  };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

const TEAM_ONE = {
    profileId: "me",
    teamId: "team-1",
    teamName: "U10 Girls",
    displayName: "U10 Girls",
    season: null,
    logoUrl: null,
    role: "player",
    winColor: "#2563eb",
};
const mockCtx = {
  membership: TEAM_ONE,
  ownProfile: { id: "me" },
  allMemberships: [{ team_id: "team-1", profile_id: "me", profiles: { first_name: "Mia", last_name: "Chen" } }] as unknown[],
  loading: false,
  refresh: jest.fn(() => Promise.resolve()),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import HomeScreen from "../app/(app)/index";
import ScheduleScreen from "../app/(app)/schedule/index";
import EventDetailScreen from "../app/(app)/schedule/[eventId]";

const LA = "America/Los_Angeles";
const TEAM = { timezone: LA, name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function event(overrides: Row): Row {
  return {
    team_id: "team-1",
    title: "Game",
    event_type: "game",
    is_cancelled: false,
    notes: null,
    arrival_time: null,
    timezone: LA,
    opponent: "Rivals FC",
    home_away: "home",
    uniform: null,
    score_for: null,
    score_against: null,
    game_result: null,
    tournament_id: null,
    league_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    league: null,
    games: [],
    teams: TEAM,
    locations: null,
    ...overrides,
  };
}

const DIV3 = { id: "div3", team_id: "team-1", name: "Division 3", season: "Fall 2026", archived_at: null };
const OLD = { id: "old", team_id: "team-1", name: "Division 4", season: "Fall 2025", archived_at: "2026-01-01T00:00:00Z" };
const played = (id: string, days: number, result: string, extra: Row = {}) =>
  event({ id, start_time: ago(days), end_time: ago(days), game_result: result, ...extra });

beforeEach(() => {
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  mockFilters.length = 0;
  mockFailing.clear();
  mockGates.clear();
  mockCtx.membership = TEAM_ONE;
  mockTables.team_members = [];
  mockTables.leagues = [];
  mockTables.availability = [];
});

// ── The rules (copied from the web) ───────────────────────────────────────────

describe("leagueRecords", () => {
  it("a row per active league, over its own games with a result", () => {
    const rows = leagueRecords(
      [DIV3, OLD],
      [
        { start_time: ago(9), game_result: "win", league_id: "div3" },
        { start_time: ago(8), game_result: "loss", league_id: "div3" },
        { start_time: ago(7), game_result: "win", league_id: "old" },
        { start_time: ago(6), game_result: "win", league_id: null },
      ]
    );
    expect(rows.map((r) => [r.label, r.record?.wins, r.record?.losses])).toEqual([["Fall 2026 Division 3", 1, 1]]);
    expect(leagueLabel(DIV3)).toBe("Fall 2026 Division 3");
  });
});

// ── The Record card ───────────────────────────────────────────────────────────

describe("the Record card", () => {
  const card = async () => screen.findByLabelText("Record");
  const section = (parent: ReturnType<typeof within>, label: string) => parent.getByLabelText(label);
  /** The card's sections, in the order they appear. */
  const sections = (record: ReturnType<typeof within>) =>
    record
      .getAllByLabelText(/^(Fall 2026 Division 3|Last tournament|Overall record)$/)
      .map((e) => e.props.accessibilityLabel);

  it("with a league: its own last game and League Record, then Overall Record last", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [
      played("a", 30, "win", { league_id: "div3" }),
      played("b", 20, "loss", { league_id: "div3", opponent: "Eagles" }),
      played("c", 10, "tie", { opponent: "Hawks" }),
    ];
    render(<HomeScreen />);

    const record = within(await card());
    const div3 = within(section(record, "Fall 2026 Division 3"));
    expect(div3.getByText("Last game")).toBeTruthy();
    // Its own last game: the loss to Eagles, not the overall tie with Hawks.
    expect(div3.getByLabelText("vs Eagles")).toBeTruthy();
    expect(div3.getByText("League Record")).toBeTruthy();
    expect(div3.getByLabelText("1 win, 1 loss, 0 ties")).toBeTruthy();

    const overall = within(section(record, "Overall record"));
    expect(overall.getByText("Overall Record")).toBeTruthy();
    expect(overall.getByLabelText("1 win, 1 loss, 1 tie")).toBeTruthy();
    expect(sections(record)).toEqual(["Fall 2026 Division 3", "Overall record"]);
  });

  it("a league with no result yet says so, and shows the card on its own", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [];
    render(<HomeScreen />);

    const record = within(await card());
    expect(within(section(record, "Fall 2026 Division 3")).getByText("No results yet")).toBeTruthy();
    expect(record.queryByLabelText("Overall record")).toBeNull();
  });

  it("an archived league has no section", async () => {
    mockTables.leagues = [OLD];
    mockTables.events = [played("a", 30, "win", { league_id: "old" })];
    render(<HomeScreen />);

    const record = within(await card());
    expect(record.queryByLabelText("Fall 2025 Division 4")).toBeNull();
    // Without an active league, the team's last game.
    expect(record.getByText("Last game")).toBeTruthy();
  });

  it("the latest finished tournament, placed or not, sits above Overall Record and stays after newer games", async () => {
    mockTables.events = [
      event({ id: "t-1", title: "Fall Classic", event_type: "tournament", opponent: null, home_away: null, start_time: ago(12), end_time: ago(10) }),
      played("tg", 11, "win", { tournament_id: "t-1" }),
      played("later", 3, "loss", { opponent: "Owls" }),
    ];
    render(<HomeScreen />);

    const record = within(await card());
    const tournament = within(section(record, "Last tournament"));
    expect(tournament.getByText("Fall Classic")).toBeTruthy();
    expect(tournament.getByText("Tournament Record")).toBeTruthy();
    expect(tournament.getByLabelText("1 win, 0 losses, 0 ties")).toBeTruthy();
    // The newer game is still the last game.
    expect(record.getByLabelText("vs Owls")).toBeTruthy();
    expect(sections(record)).toEqual(["Last tournament", "Overall record"]);
  });

  it("a placement shows when there is one", async () => {
    mockTables.events = [
      event({ id: "t-1", title: "Fall Classic", event_type: "tournament", opponent: null, home_away: null, start_time: ago(12), end_time: ago(10), placement_rank: 2 }),
    ];
    render(<HomeScreen />);

    expect(within(section(within(await card()), "Last tournament")).getByText("2nd place")).toBeTruthy();
  });

  it("asks for active leagues, and the latest finished tournament placed or not", async () => {
    mockTables.events = [];
    render(<HomeScreen />);
    await screen.findByText("Upcoming Events");

    expect(mockFilters.some((f) => f.table === "leagues" && f.method === "is" && f.column === "archived_at")).toBe(true);
    expect(screen.queryByLabelText("Record")).toBeNull();
  });
});

// ── Tags and the game screen ──────────────────────────────────────────────────

const LEAGUE_GAME = event({
  id: "g-league",
  start_time: ahead(5),
  end_time: ahead(5),
  league_id: "div3",
  league: { name: "Division 3", season: "Fall 2026" },
});

describe("league tags", () => {
  it("on the schedule", async () => {
    mockTables.events = [LEAGUE_GAME, event({ id: "g-free", opponent: "Hawks", start_time: ahead(6), end_time: ahead(6) })];
    render(<ScheduleScreen />);

    expect(await screen.findByText("Fall 2026 Division 3")).toBeTruthy();
    expect(screen.getAllByText("Fall 2026 Division 3")).toHaveLength(1);
  });

  it("on home's Upcoming", async () => {
    mockTables.events = [LEAGUE_GAME];
    render(<HomeScreen />);

    expect(await screen.findByText("Fall 2026 Division 3")).toBeTruthy();
  });
});

describe("a game's screen", () => {
  it("names its league, and labels Home / Away", async () => {
    mockEventId = "g-league";
    mockTables.events = [LEAGUE_GAME];
    render(<EventDetailScreen />);

    const details = await screen.findByLabelText("Game details");
    expect(within(details).getByText("League")).toBeTruthy();
    expect(within(details).getByText("Fall 2026 Division 3")).toBeTruthy();
    expect(within(details).getByText("Home / Away")).toBeTruthy();
  });
});

// ── TL-026 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ───────

describe("TL-026: a failed read is never shown as no results", () => {
  const RESULTS = "events:event_type=game";
  const leagueWin = () => played("a", 30, "win", { league_id: "div3" });

  it("a first read failing says so, not \"No results yet\", and Try again reads it", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [leagueWin()];
    mockFailing.add(RESULTS);
    render(<HomeScreen />);

    const record = within(await screen.findByLabelText("Record"));
    expect(record.getByText(/Couldn't load the record/)).toBeTruthy();
    expect(record.queryByText("No results yet")).toBeNull();
    expect(record.queryByLabelText("Overall record")).toBeNull();

    mockFailing.clear();
    fireEvent.press(record.getByLabelText("Try again"));
    await waitFor(() => expect(screen.getByText("League Record")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("a failed refresh keeps the record it had, and says it may be out of date", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [leagueWin()];
    render(<HomeScreen />);
    await screen.findByText("League Record");

    mockFailing.add(RESULTS);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), "refresh");

    expect(await screen.findByText(/Couldn't refresh the record/)).toBeTruthy();
    expect(screen.getByText("League Record")).toBeTruthy();
    expect(screen.queryByText("No results yet")).toBeNull();
  });

  it("the leagues read failing is the same: no card that's missing its leagues", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [leagueWin()];
    mockFailing.add("leagues:team_id=team-1");
    render(<HomeScreen />);

    const record = within(await screen.findByLabelText("Record"));
    expect(record.getByText(/Couldn't load the record/)).toBeTruthy();
    expect(record.queryByText("Last game")).toBeNull();
  });

  it("a successful empty read still shows the league's \"No results yet\"", async () => {
    mockTables.leagues = [DIV3];
    mockTables.events = [];
    render(<HomeScreen />);

    const record = within(await screen.findByLabelText("Record"));
    expect(record.getByText("No results yet")).toBeTruthy();
    expect(record.queryByText(/Couldn't/)).toBeNull();
  });
});

// ── TL-027 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ───────

describe("TL-027: a record kept after a failed read is only ever the same team's", () => {
  const TEAM_TWO = { ...TEAM_ONE, teamId: "team-2", teamName: "U12 Boys", displayName: "U12 Boys" };
  const DIV5 = { id: "div5", team_id: "team-2", name: "Division 5", season: "Fall 2026", archived_at: null };
  const seed = () => {
    mockTables.leagues = [DIV3, DIV5];
    mockTables.events = [
      played("a", 30, "win", { league_id: "div3" }),
      played("b", 20, "loss", { league_id: "div5", team_id: "team-2" }),
    ];
  };
  const switchTeam = (rerender: (el: React.ReactElement) => void) => {
    mockCtx.membership = TEAM_TWO;
    rerender(<HomeScreen />);
  };

  for (const [read, key] of [
    ["results", "events:team_id=team-2"],
    ["leagues", "leagues:team_id=team-2"],
  ] as const) {
    it(`the new team's ${read} read failing shows a failed load, not the old team's record`, async () => {
      seed();
      const { rerender } = render(<HomeScreen />);
      await screen.findByText("Fall 2026 Division 3");

      mockFailing.add(key);
      switchTeam(rerender);

      const record = within(await screen.findByLabelText("Record"));
      expect(await record.findByText(/Couldn't load the record/)).toBeTruthy();
      expect(screen.queryByText("Fall 2026 Division 3")).toBeNull();
      expect(screen.queryByText(/Couldn't refresh/)).toBeNull();

      mockFailing.clear();
      fireEvent.press(record.getByLabelText("Try again"));
      expect(await screen.findByText("Fall 2026 Division 5")).toBeTruthy();
      expect(screen.queryByText("Fall 2026 Division 3")).toBeNull();
    });
  }

  it("the old team's slow reply, landing after the switch, doesn't replace the new team's record", async () => {
    seed();
    let release!: () => void;
    mockGates.set("leagues:team_id=team-1", new Promise<void>((r) => (release = r)));
    const { rerender } = render(<HomeScreen />);

    switchTeam(rerender);
    expect(await screen.findByText("Fall 2026 Division 5")).toBeTruthy();

    release();
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.getByText("Fall 2026 Division 5")).toBeTruthy());
    expect(screen.queryByText("Fall 2026 Division 3")).toBeNull();
  });

  it("a failed refresh of the same team still keeps its record", async () => {
    seed();
    const { rerender } = render(<HomeScreen />);
    await screen.findByText("Fall 2026 Division 3");
    switchTeam(rerender);
    await screen.findByText("Fall 2026 Division 5");

    mockFailing.add("events:team_id=team-2");
    fireEvent(screen.UNSAFE_getByType(RefreshControl), "refresh");

    expect(await screen.findByText(/Couldn't refresh the record/)).toBeTruthy();
    expect(screen.getByText("Fall 2026 Division 5")).toBeTruthy();
  });
});
