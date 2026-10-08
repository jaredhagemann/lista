/**
 * Tournaments on the phone (docs/specs/tournaments-and-leagues.md §4, "Mobile
 * app"; D2, D8, D11, D13; part 3). Display and answering only.
 *
 *   - home and schedule: a tournament is one card with its dates, never times,
 *     and "Now" while it's underway; its games are their own rows with
 *     "Surf Cup · Semifinal". Upcoming is by overlap, so an underway tournament
 *     stays listed until it ends
 *   - the tournament screen: dates, placement and record, its games, and the
 *     picker for the tournament
 *   - a game's screen: "Part of Surf Cup", linking to it, and its own picker,
 *     which shows the inherited answer until one is set
 *   - the Record card shows the last placed tournament until a newer game (D8)
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockWrites: { kind: "upsert" | "delete"; table: string; row: Row }[] = [];
const mockFilters: { table: string; method: string; column: string; value: unknown }[] = [];

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const deleting: Row = {};
    let isDelete = false;
    const keep = (method: string, column: string, value: unknown, test: (row: Row) => boolean) => {
      mockFilters.push({ table, method, column, value });
      filters.push((row) => !(column in row) || test(row));
      return chain;
    };
    const at = (v: unknown) => Date.parse(String(v));
    const result = () => {
      if (isDelete) {
        mockWrites.push({ kind: "delete", table, row: deleting });
        return Promise.resolve({ data: null, error: null });
      }
      const data = (mockTables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      return Promise.resolve({ data, error: null, count: data.length });
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        if (isDelete) deleting[c] = v;
        return keep("eq", c, v, (r) => r[c] === v);
      },
      in: (c: string, v: unknown[]) => keep("in", c, v, (r) => v.includes(r[c])),
      gt: (c: string, v: unknown) => keep("gt", c, v, (r) => at(r[c]) > at(v)),
      gte: (c: string, v: unknown) => keep("gte", c, v, (r) => at(r[c]) >= at(v)),
      lt: (c: string, v: unknown) => keep("lt", c, v, (r) => at(r[c]) < at(v)),
      lte: (c: string, v: unknown) => keep("lte", c, v, (r) => at(r[c]) <= at(v)),
      not: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      delete: () => {
        isDelete = true;
        return chain;
      },
      upsert: (row: Row) => {
        mockWrites.push({ kind: "upsert", table, row });
        return Promise.resolve({ error: null });
      },
      single: () => result().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    chain.maybeSingle = chain.single;
    return chain;
  };
  return { supabase: { from } };
});

const mockPush = jest.fn();
let mockEventId = "t-1";
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: mockPush }),
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

const mockCtx = {
  membership: {
    profileId: "me",
    teamId: "team-1",
    teamName: "U10 Girls",
    displayName: "U10 Girls",
    season: null,
    logoUrl: null,
    role: "player",
    winColor: "#2563eb",
  },
  ownProfile: { id: "me" },
  allMemberships: [{ team_id: "team-1", profile_id: "me", profiles: { first_name: "Mia", last_name: "Chen" } }] as unknown[],
  loading: false,
  refresh: jest.fn(() => Promise.resolve()),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import HomeScreen from "../app/(app)/index";
import ScheduleScreen from "../app/(app)/schedule/index";
import EventDetailScreen from "../app/(app)/schedule/[eventId]";
import { tournamentDates } from "../lib/tournament";

const LA = "America/Los_Angeles";
const TEAM = { timezone: LA, name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };
const HOUR = 60 * 60 * 1000;

function event(overrides: Row): Row {
  return {
    team_id: "team-1",
    title: "Game",
    event_type: "game",
    is_cancelled: false,
    notes: null,
    arrival_time: null,
    timezone: LA,
    opponent: null,
    home_away: null,
    uniform: null,
    score_for: null,
    score_against: null,
    game_result: null,
    tournament_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    teams: TEAM,
    locations: null,
    ...overrides,
  };
}

// Fri Dec 11 – Sun Dec 13, 2099, Pacific.
const SURF_CUP = event({
  id: "t-1",
  title: "Surf Cup",
  event_type: "tournament",
  start_time: "2099-12-11T08:00:00.000Z",
  end_time: "2099-12-14T08:00:00.000Z",
  locations: { name: "Del Mar Fields", address: null },
  games: [{ count: 2 }],
});
const POOL_A = event({
  id: "g-1",
  tournament_id: "t-1",
  round: "Pool A",
  opponent: "Rivals FC",
  home_away: "home",
  start_time: "2099-12-11T17:00:00.000Z",
  end_time: "2099-12-11T18:30:00.000Z",
  tournament: { id: "t-1", title: "Surf Cup" },
});
const FINAL = event({
  id: "g-2",
  title: "Final",
  tournament_id: "t-1",
  round: "Final",
  start_time: "2099-12-13T22:00:00.000Z",
  end_time: "2099-12-13T23:30:00.000Z",
  tournament: { id: "t-1", title: "Surf Cup" },
});

const ROSTER = [
  { team_id: "team-1", profile_id: "me", role: "player", profiles: { first_name: "Mia", last_name: "Chen" } },
  { team_id: "team-1", profile_id: "ava", role: "player", profiles: { first_name: "Ava", last_name: "Smith" } },
];

beforeEach(() => {
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  mockWrites.length = 0;
  mockFilters.length = 0;
  mockPush.mockClear();
  mockTables.events = [SURF_CUP, POOL_A, FINAL];
  mockTables.team_members = ROSTER;
  mockTables.availability = [];
});

// ── The schedule ──────────────────────────────────────────────────────────────

describe("the schedule", () => {
  it("shows a tournament as one card with its dates and games, never times", async () => {
    render(<ScheduleScreen />);

    const card = await screen.findByLabelText("Surf Cup, tournament");
    expect(within(card).getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    expect(within(card).getByText("2 games")).toBeTruthy();
    expect(within(card).getByText("Tournament")).toBeTruthy();
    expect(within(card).queryByText(/AM|PM/)).toBeNull();
  });

  it("names each game's tournament and round", async () => {
    render(<ScheduleScreen />);

    expect(await screen.findByText("Surf Cup · Pool A")).toBeTruthy();
    expect(screen.getByText("Surf Cup · Final")).toBeTruthy();
  });

  it("shows a game's answer: its own, or the tournament's it follows", async () => {
    mockTables.availability = [
      { event_id: "t-1", profile_id: "me", status: "available" },
      { event_id: "g-2", profile_id: "me", status: "unavailable" },
    ];
    render(<ScheduleScreen />);

    expect(await screen.findByLabelText("Your answer for U10 Girls vs Rivals FC: Available, from the tournament")).toBeTruthy();
    expect(screen.getByLabelText("Your answer for Final: Unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Your answer for Surf Cup: Available")).toBeTruthy();
  });

  it("marks a tournament that's underway Now", async () => {
    const now = Date.now();
    mockTables.events = [
      { ...SURF_CUP, start_time: new Date(now - 24 * HOUR).toISOString(), end_time: new Date(now + 48 * HOUR).toISOString() },
    ];
    render(<ScheduleScreen />);

    const card = await screen.findByLabelText("Surf Cup, tournament");
    expect(within(card).getByText("Now")).toBeTruthy();
  });
});

// ── Home ──────────────────────────────────────────────────────────────────────

describe("home", () => {
  it("lists events by overlap: an underway tournament stays in Upcoming", async () => {
    const now = Date.now();
    const underway = { ...SURF_CUP, start_time: new Date(now - 24 * HOUR).toISOString(), end_time: new Date(now + 48 * HOUR).toISOString() };
    mockTables.events = [underway, POOL_A];
    render(<HomeScreen />);

    const row = await screen.findByLabelText("Surf Cup, tournament");
    expect(within(row).getByText("Now")).toBeTruthy();
    expect(within(row).getByText(`${tournamentDates(underway as never)} · 2 games`)).toBeTruthy();
    // By end time, not start time.
    expect(mockFilters.some((f) => f.table === "events" && f.method === "gt" && f.column === "end_time")).toBe(true);
    expect(screen.getByText("Surf Cup · Pool A")).toBeTruthy();
  });

  it("shows the last placed tournament on the Record card until a newer game (D8)", async () => {
    const past = (days: number) => new Date(Date.now() - days * 24 * HOUR).toISOString();
    mockTables.events = [
      event({ id: "old", opponent: "Eagles", start_time: past(30), end_time: past(30), game_result: "win" }),
      event({
        id: "t-past",
        title: "Fall Classic",
        event_type: "tournament",
        start_time: past(10),
        end_time: past(8),
        placement_rank: 2,
      }),
      event({ id: "tg-1", tournament_id: "t-past", opponent: "Hawks", start_time: past(9), end_time: past(9), game_result: "win" }),
      event({ id: "tg-2", tournament_id: "t-past", opponent: "Owls", start_time: past(9), end_time: past(9), game_result: "loss" }),
    ];
    render(<HomeScreen />);

    const card = await screen.findByLabelText("Record");
    expect(within(card).getByText("Last tournament")).toBeTruthy();
    expect(within(card).getByText("Fall Classic")).toBeTruthy();
    expect(within(card).getByText("2nd place")).toBeTruthy();
    expect(within(card).getByLabelText("Tournament record 1–1–0")).toBeTruthy();
  });

  it("a game after the tournament is the last result again", async () => {
    const past = (days: number) => new Date(Date.now() - days * 24 * HOUR).toISOString();
    mockTables.events = [
      event({ id: "t-past", title: "Fall Classic", event_type: "tournament", start_time: past(10), end_time: past(8), placement_rank: 2 }),
      event({ id: "newer", opponent: "Eagles", start_time: past(2), end_time: past(2), game_result: "win" }),
    ];
    render(<HomeScreen />);

    const card = await screen.findByLabelText("Record");
    expect(within(card).getByText("Last game")).toBeTruthy();
    expect(within(card).queryByText("Fall Classic")).toBeNull();
  });
});

// ── The tournament screen ─────────────────────────────────────────────────────

describe("the tournament screen", () => {
  beforeEach(() => {
    mockEventId = "t-1";
  });

  it("shows its dates, never an end time", async () => {
    render(<EventDetailScreen />);

    expect(await screen.findByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    expect(screen.queryByText(/^Ends/)).toBeNull();
    expect(screen.getByText("Del Mar Fields")).toBeTruthy();
  });

  it("lists its games, each opening its own screen", async () => {
    render(<EventDetailScreen />);

    const games = await screen.findByLabelText("Games");
    const rows = within(games).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(within(rows[0]).getByText(/Pool A/)).toBeTruthy();
    fireEvent.press(rows[1]);
    expect(mockPush).toHaveBeenCalledWith("/(app)/schedule/g-2");
  });

  it("shows its placement and record once there are", async () => {
    mockTables.events = [
      { ...SURF_CUP, start_time: "2020-12-11T08:00:00.000Z", end_time: "2020-12-14T08:00:00.000Z", placement_rank: 3 },
      { ...POOL_A, start_time: "2020-12-11T17:00:00.000Z", game_result: "win" },
      { ...FINAL, start_time: "2020-12-13T22:00:00.000Z", game_result: "tie" },
    ];
    render(<EventDetailScreen />);

    expect(await screen.findByText("3rd place")).toBeTruthy();
    expect(screen.getByLabelText("Tournament record 1–0–1")).toBeTruthy();
  });

  it("its picker answers the tournament", async () => {
    render(<EventDetailScreen />);

    fireEvent.press(await screen.findByLabelText("Available"));

    await waitFor(() =>
      expect(mockWrites).toEqual([
        { kind: "upsert", table: "availability", row: { event_id: "t-1", profile_id: "me", status: "available" } },
      ])
    );
  });
});

// ── A game in a tournament ────────────────────────────────────────────────────

describe("a game in a tournament", () => {
  beforeEach(() => {
    mockEventId = "g-1";
  });

  const selected = (label: string) => screen.getByLabelText(label).props.accessibilityState?.selected;

  it("says it's part of the tournament, linking to it", async () => {
    render(<EventDetailScreen />);

    fireEvent.press(await screen.findByLabelText("Part of Surf Cup · Pool A"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/schedule/t-1");
  });

  it("shows your tournament answer until you set one for the game", async () => {
    mockTables.availability = [{ event_id: "t-1", profile_id: "me", status: "available" }];
    render(<EventDetailScreen />);

    expect(await screen.findByText(/From your Surf Cup answer/)).toBeTruthy();
    expect(selected("Available")).toBe(true);
  });

  it("answering sets the game's own answer; clearing it goes back to the tournament's", async () => {
    mockTables.availability = [{ event_id: "t-1", profile_id: "me", status: "available" }];
    render(<EventDetailScreen />);
    await screen.findByText(/From your Surf Cup answer/);

    fireEvent.press(screen.getByLabelText("Unavailable"));
    await waitFor(() =>
      expect(mockWrites).toEqual([
        { kind: "upsert", table: "availability", row: { event_id: "g-1", profile_id: "me", status: "unavailable" } },
      ])
    );
    expect(selected("Unavailable")).toBe(true);
    expect(screen.getByText(/Set for this game/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Unavailable"));
    await waitFor(() => expect(mockWrites[1]).toMatchObject({ kind: "delete", row: { event_id: "g-1", profile_id: "me" } }));
    expect(selected("Available")).toBe(true);
    expect(screen.getByText(/From your Surf Cup answer/)).toBeTruthy();
  });

  it("its responses show resulting answers, inherited ones marked", async () => {
    mockTables.availability = [
      { event_id: "t-1", profile_id: "ava", status: "available" },
      { event_id: "t-1", profile_id: "me", status: "available" },
      { event_id: "g-1", profile_id: "me", status: "maybe" },
    ];
    render(<EventDetailScreen />);

    const available = await screen.findByLabelText("Available (1)");
    expect(within(available).getByText("Ava Smith")).toBeTruthy();
    expect(within(available).getByText("from Surf Cup")).toBeTruthy();
    const maybe = screen.getByLabelText("Maybe (1)");
    expect(within(maybe).getByText("Mia Chen")).toBeTruthy();
    expect(within(maybe).queryByText("from Surf Cup")).toBeNull();
  });
});
