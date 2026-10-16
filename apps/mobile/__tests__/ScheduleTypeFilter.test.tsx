/**
 * The schedule's type filter (2026-10-15). The header's "+" did nothing (events
 * are made on the web), so it's gone; in its place, a row of pills above the
 * list filters by type, as the web's schedule does: All, Game, Practice,
 * Tournament, Other.
 *
 *   - the web's rules: Game is every game, a tournament's included; Tournament
 *     is the tournaments themselves
 *   - the filter applies to the list already read: no new reads
 *   - a filter with no events says so, with Clear filter
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { RefreshControl } from "react-native";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockReads: string[] = [];
const mockSetOptions = jest.fn();

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    mockReads.push(table);
    const result = () => Promise.resolve({ data: (mockTables[table] ?? []).map((r) => ({ ...r })), error: null });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "gt", "gte", "lt", "lte", "not", "or", "order", "limit"]) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return { supabase: { from } };
});

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useNavigation: () => ({ setOptions: mockSetOptions }),
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
    role: "coach",
    winColor: "#2563eb",
  },
  loading: false,
  refresh: jest.fn(() => Promise.resolve()),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import ScheduleScreen from "../app/(app)/schedule/index";

const LA = "America/Los_Angeles";
const TEAM = { timezone: LA, name: "U10 Girls" };
const DAY = 24 * 60 * 60 * 1000;
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function event(id: string, days: number, overrides: Row): Row {
  return {
    id,
    title: "Event",
    event_type: "other",
    start_time: ahead(days),
    end_time: ahead(days + 0.05),
    is_cancelled: false,
    timezone: LA,
    opponent: null,
    home_away: null,
    score_for: null,
    score_against: null,
    tournament_id: null,
    round: null,
    teams: TEAM,
    locations: null,
    tournament: null,
    league: null,
    games: null,
    ...overrides,
  };
}

const PRACTICE = event("p-1", 1, { title: "Tuesday practice", event_type: "practice" });
const GAME = event("g-1", 2, { title: "Game", event_type: "game", opponent: "Rivals FC", home_away: "home" });
const TOURNAMENT = event("t-1", 5, { title: "Surf Cup", event_type: "tournament", end_time: ahead(7), games: [{ count: 1 }] });
const TOURNAMENT_GAME = event("g-2", 5, {
  title: "Game",
  event_type: "game",
  opponent: "Bay FC",
  home_away: "away",
  tournament_id: "t-1",
  round: "Final",
  tournament: { title: "Surf Cup" },
});
const PARTY = event("o-1", 9, { title: "Team party", event_type: "other" });

const shown = () => ({
  practice: screen.queryByText("Tuesday practice") != null,
  game: screen.queryByText(/Rivals FC/) != null,
  tournamentGame: screen.queryByText(/Bay FC/) != null,
  tournament: screen.queryByText("Surf Cup") != null,
  other: screen.queryByText("Team party") != null,
});

const pill = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  mockReads.length = 0;
  mockSetOptions.mockClear();
  mockTables.events = [PRACTICE, GAME, TOURNAMENT, TOURNAMENT_GAME, PARTY];
  mockTables.availability = [];
});

describe("the header", () => {
  it("has no + button, even for a coach: events are made on the web", async () => {
    render(<ScheduleScreen />);
    await screen.findByText("Team party");

    for (const [options] of mockSetOptions.mock.calls) {
      expect(options.headerRight).toBeUndefined();
    }
  });
});

describe("the type filter", () => {
  it("offers All, Game, Practice, Tournament and Other, with All selected and everything shown", async () => {
    render(<ScheduleScreen />);
    await screen.findByText("Team party");

    for (const name of ["All", "Game", "Practice", "Tournament", "Other"]) expect(pill(name)).toBeTruthy();
    expect(pill("All").props.accessibilityState).toMatchObject({ selected: true });
    expect(shown()).toEqual({ practice: true, game: true, tournamentGame: true, tournament: true, other: true });
  });

  it("Game shows every game, a tournament's included, and nothing else", async () => {
    render(<ScheduleScreen />);
    await screen.findByText("Team party");

    fireEvent.press(pill("Game"));

    expect(pill("Game").props.accessibilityState).toMatchObject({ selected: true });
    expect(pill("All").props.accessibilityState).toMatchObject({ selected: false });
    expect(shown()).toEqual({ practice: false, game: true, tournamentGame: true, tournament: false, other: false });
  });

  it("Practice, Tournament and Other each show their own", async () => {
    render(<ScheduleScreen />);
    await screen.findByText("Team party");

    fireEvent.press(pill("Practice"));
    expect(shown()).toEqual({ practice: true, game: false, tournamentGame: false, tournament: false, other: false });

    fireEvent.press(pill("Tournament"));
    expect(shown()).toEqual({ practice: false, game: false, tournamentGame: false, tournament: true, other: false });

    fireEvent.press(pill("Other"));
    expect(shown()).toEqual({ practice: false, game: false, tournamentGame: false, tournament: false, other: true });

    fireEvent.press(pill("All"));
    expect(shown()).toEqual({ practice: true, game: true, tournamentGame: true, tournament: true, other: true });
  });

  it("filters what was read, without reading again", async () => {
    render(<ScheduleScreen />);
    await screen.findByText("Team party");
    const reads = mockReads.length;

    fireEvent.press(pill("Game"));
    fireEvent.press(pill("Practice"));

    expect(mockReads).toHaveLength(reads);
  });

  it("a type with no events says so, and Clear filter shows everything again", async () => {
    mockTables.events = [PRACTICE, GAME];
    render(<ScheduleScreen />);
    await screen.findByText("Tuesday practice");

    fireEvent.press(pill("Tournament"));

    expect(screen.getByText("No tournaments scheduled.")).toBeTruthy();
    expect(pill("Tournament")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Clear filter" }));
    expect(pill("All").props.accessibilityState).toMatchObject({ selected: true });
    expect(shown().practice && shown().game).toBe(true);
  });

  it("a team with no events at all keeps its empty state, without the filter", async () => {
    mockTables.events = [];
    render(<ScheduleScreen />);

    expect(await screen.findByText("No events scheduled yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Game" })).toBeNull();
  });
});

// ── TL-028 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ───────

describe("TL-028: an empty schedule can still be pulled to refresh", () => {
  /** Pulls the list down, as a person would, and waits for the read. */
  async function pullToRefresh() {
    await act(async () => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
  }

  it("an empty schedule refreshes, and shows an event made on the web since", async () => {
    mockTables.events = [];
    render(<ScheduleScreen />);
    await screen.findByText("No events scheduled yet.");

    mockTables.events = [GAME];
    await pullToRefresh();

    expect(await screen.findByText(/Rivals FC/)).toBeTruthy();
    expect(screen.queryByText("No events scheduled yet.")).toBeNull();
  });

  it("a type with no events refreshes, keeping the type selected", async () => {
    mockTables.events = [PRACTICE];
    render(<ScheduleScreen />);
    await screen.findByText("Tuesday practice");
    fireEvent.press(pill("Game"));
    expect(screen.getByText("No games scheduled.")).toBeTruthy();

    mockTables.events = [PRACTICE, GAME];
    await pullToRefresh();

    expect(await screen.findByText(/Rivals FC/)).toBeTruthy();
    expect(pill("Game").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByText("Tuesday practice")).toBeNull();
  });

  it("a schedule with events still refreshes (a control)", async () => {
    mockTables.events = [PRACTICE];
    render(<ScheduleScreen />);
    await screen.findByText("Tuesday practice");

    mockTables.events = [PRACTICE, GAME];
    await pullToRefresh();

    expect(await screen.findByText(/Rivals FC/)).toBeTruthy();
  });
});
