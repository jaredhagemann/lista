/**
 * Where games are named and described (spec: docs/specs/mobile-next-build.md §1).
 *
 * As on the web, a game with an opponent is "[Team] vs [opponent]" at home (or
 * home/away unset) and "[Team] @ [opponent]" away, on the home screen, the
 * schedule and the event screen, with the score once both sides are entered.
 * The team is the event's own. The event screen adds the game's details: the
 * opponent, home or away, the uniform by the team's name for it in its color,
 * and the result.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react-native";

const mockSelects: Record<string, string[]> = {};
const mockTables: Record<string, unknown> = {};

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: mockTables[table] ?? null, error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["eq", "gt", "gte", "lte", "or", "order", "limit", "in", "not"]) chain[m] = () => chain;
    chain.select = (columns: string) => {
      (mockSelects[table] ??= []).push(columns);
      return chain;
    };
    chain.single = () => result().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] : r.data }));
    chain.maybeSingle = chain.single;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return { supabase: { from } };
});

const mockSetOptions = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useNavigation: () => ({ setOptions: mockSetOptions }),
    useLocalSearchParams: () => ({ eventId: "e-away" }),
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
    teamId: "t-1",
    teamName: "U10 Girls",
    displayName: "SLOFC - U10 Girls",
    season: null,
    logoUrl: null,
    role: "player",
    homeUniform: null,
    awayUniform: null,
  },
  ownProfile: { id: "me" },
  allMemberships: [] as unknown[],
  loading: false,
  refresh: jest.fn(),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import HomeScreen from "../app/(app)/index";
import ScheduleScreen from "../app/(app)/schedule/index";
import EventDetailScreen from "../app/(app)/schedule/[eventId]";

// The event's own team: its name and uniforms, as the queries now select them.
const TEAM = {
  timezone: "America/Los_Angeles",
  name: "U10 Girls",
  home_uniform: "Navy",
  away_uniform: null,
  home_uniform_color: "#1e3a8a",
  away_uniform_color: "#ffffff",
};

function event(id: string, fields: Record<string, unknown>) {
  return {
    id,
    title: "Saturday game",
    event_type: "game",
    start_time: "2030-10-05T17:00:00.000Z",
    end_time: "2030-10-05T18:30:00.000Z",
    is_cancelled: false,
    notes: null,
    arrival_time: null,
    timezone: null,
    opponent: null,
    home_away: null,
    uniform: null,
    score_for: null,
    score_against: null,
    game_result: null,
    teams: TEAM,
    locations: null,
    ...fields,
  };
}

const HOME_GAME = event("e-home", { opponent: "Rivals FC", home_away: "home", uniform: "home" });
const AWAY_GAME = event("e-away", {
  opponent: "Rivals FC",
  home_away: "away",
  uniform: "away",
  score_for: 3,
  score_against: 1,
  game_result: "win",
});
const NO_OPPONENT = event("e-bare", { title: "Scrimmage" });
const PRACTICE = event("e-practice", { title: "Tuesday training", event_type: "practice" });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockSelects)) delete mockSelects[key];
  mockTables.events = [HOME_GAME, AWAY_GAME, NO_OPPONENT, PRACTICE];
  mockTables.availability = [];
  mockTables.team_members = [];
});

function expectSelected(columns: string[]) {
  const selected = mockSelects.events?.join(" ") ?? "";
  for (const column of columns) expect(selected).toContain(column);
}

describe("the home screen's upcoming events", () => {
  it("names games by the team and opponent, and keeps other titles", async () => {
    render(<HomeScreen />);

    expect(await screen.findByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(screen.getByText("U10 Girls @ Rivals FC · 3–1")).toBeTruthy();
    expect(screen.getByText("Scrimmage")).toBeTruthy();
    expect(screen.getByText("Tuesday training")).toBeTruthy();
    expectSelected(["opponent", "home_away", "score_for", "score_against", "teams(", "name"]);
  });
});

describe("the schedule", () => {
  it("names games by the team and opponent, with the score", async () => {
    render(<ScheduleScreen />);

    expect(await screen.findByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(screen.getByText("U10 Girls @ Rivals FC · 3–1")).toBeTruthy();
    expect(screen.getByText("Scrimmage")).toBeTruthy();
    expectSelected(["opponent", "home_away", "score_for", "score_against", "teams(", "name"]);
  });
});

describe("the event screen", () => {
  it("titles the game, and shows its opponent, side, uniform in its color, and result", async () => {
    mockTables.events = [AWAY_GAME];
    render(<EventDetailScreen />);

    expect(await screen.findByText("U10 Girls @ Rivals FC · 3–1")).toBeTruthy();
    expect(mockSetOptions).toHaveBeenCalledWith({ title: "U10 Girls @ Rivals FC · 3–1" });

    const details = screen.getByLabelText("Game details");
    expect(within(details).getByText("Rivals FC")).toBeTruthy();
    expect(within(details).getByText("Away")).toBeTruthy();
    expect(within(details).getByText("Win")).toBeTruthy();
    expect(within(details).getByText("3–1")).toBeTruthy();

    // The away uniform is unnamed: "Away uniform", on a white pill with black
    // text and a border, since white would vanish into the white card.
    const pill = within(details).getByLabelText("Uniform: Away uniform");
    const style = Object.assign({}, ...[pill.props.style].flat());
    expect(style.backgroundColor).toBe("#ffffff");
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(within(pill).getByText("Away uniform").props.style).toMatchObject({ color: "#000000" });

    expectSelected(["opponent", "home_away", "uniform", "score_for", "score_against", "game_result", "home_uniform_color", "away_uniform_color"]);
  });

  it("names a home uniform by the team's name for it, with white text on navy and no border", async () => {
    mockTables.events = [HOME_GAME];
    render(<EventDetailScreen />);

    const pill = await screen.findByLabelText("Uniform: Navy");
    const style = Object.assign({}, ...[pill.props.style].flat());
    expect(style.backgroundColor).toBe("#1e3a8a");
    expect(style.borderWidth ?? 0).toBe(0);
    expect(within(pill).getByText("Navy").props.style).toMatchObject({ color: "#ffffff" });
    expect(screen.queryByText("Win")).toBeNull();
  });

  it("wraps long values within the card instead of pushing past it (review of #103)", async () => {
    // Jest doesn't lay out, so this pins the constraints that make values wrap:
    // each value sits in a container that takes the row's remaining width (and
    // may shrink below its content), and the uniform pill is capped to it.
    const LONG = "Santa Barbara Soccer Club Premier Academy Under-10 Girls Blue";
    mockTables.events = [
      event("e-long", {
        opponent: LONG,
        home_away: "home",
        uniform: "home",
        teams: { ...TEAM, home_uniform: "Heritage navy with gold trim and white shorts" },
      }),
    ];
    render(<EventDetailScreen />);

    type Node = { type: unknown; props: { style?: unknown }; parent: Node | null };
    const flat = (el: Node) => Object.assign({}, ...[el.props.style].flat());
    /** The nearest native View around an element (skipping component wrappers). */
    const hostViewAround = (el: Node) => {
      let node = el.parent;
      while (node && node.type !== "View") node = node.parent;
      return node!;
    };
    const constrained = (el: Node) => {
      const s = flat(el);
      return s.flex === 1 && s.minWidth === 0;
    };

    const opponent = (await screen.findByText(LONG)) as unknown as Node;
    expect(constrained(hostViewAround(opponent))).toBe(true);

    const pill = screen.getByLabelText("Uniform: Heritage navy with gold trim and white shorts") as unknown as Node;
    expect(flat(pill).maxWidth).toBe("100%");
    expect(constrained(hostViewAround(pill))).toBe(true);
  });

  it("shows no game details for a practice", async () => {
    mockTables.events = [PRACTICE];
    render(<EventDetailScreen />);

    expect(await screen.findByText("Tuesday training")).toBeTruthy();
    expect(screen.queryByLabelText("Game details")).toBeNull();
  });
});
