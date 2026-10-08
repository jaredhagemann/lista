/**
 * The home screen's Team and Record cards, as on the web's dashboard (spec:
 * docs/specs/mobile-next-build.md §1, part 4; the web's
 * docs/specs/team-branding-and-labels.md §4).
 *
 * - Team card: the team's logo (its own, or its club's), or its initials; its
 *   name, with the club and season under it; the members by name and role,
 *   coaches and staff first, each opening their page; the count and the roster.
 * - Record card: once a game has a result, the last game as a two-line
 *   scoreline with its date and time, and wins, losses and ties with a bar split
 *   in those proportions (wins in the club's secondary color, else lista blue).
 */

import React from "react";
import { Image } from "react-native";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react-native";

const mockTables: Record<string, unknown> = {};
const mockPush = jest.fn();

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const filters: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "gte", "lte", "or", "order", "limit", "in", "not"]) {
      chain[m] = (...args: unknown[]) => {
        filters.push(`${m}:${String(args[0])}`);
        return chain;
      };
    }
    // The dashboard reads events twice: upcoming ones, and games with a result.
    const key = () => (table === "events" && filters.includes("not:game_result") ? "results" : table);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: mockTables[key()] ?? [], error: null, count: null }).then(res, rej);
    return chain;
  };
  return { supabase: { from } };
});

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("react-native-svg", () => ({ SvgUri: () => null }));

const LOGO = "https://x.supabase.co/storage/v1/object/public/team-images/t-1/logo?t=1";

const mockCtx = {
  membership: {
    profileId: "me",
    teamId: "t-1",
    teamName: "12U Girls",
    displayName: "SLOFC - 12U Girls",
    clubName: "SLOFC" as string | null,
    season: "Fall 2026" as string | null,
    logoUrl: LOGO as string | null,
    winColor: "#C8102E",
    role: "player",
    homeUniform: null,
    awayUniform: null,
  },
  loading: false,
  refresh: jest.fn(),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import HomeScreen from "../app/(app)/index";

const member = (id: string, role: string, first: string, last: string) => ({
  id,
  role,
  profiles: { first_name: first, last_name: last },
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
  })) as never;
  Object.assign(mockCtx.membership, { clubName: "SLOFC", season: "Fall 2026", logoUrl: LOGO, winColor: "#C8102E" });
  mockTables.events = [];
  mockTables.team_members = [
    member("m-zoe", "player", "Zoe", "Young"),
    member("m-sam", "coach", "Sam", "Okafor"),
    member("m-ava", "player", "Ava", "Chen"),
    member("m-max", "manager", "Max", "Lee"),
    member("m-dee", "director", "Dee", "Park"),
  ];
  mockTables.results = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const card = (name: "Team" | "Record") => screen.getByLabelText(name);

function result(start: string, gameResult: string, extra: Record<string, unknown> = {}) {
  return {
    start_time: start,
    timezone: "America/Los_Angeles",
    opponent: "Rivals FC",
    home_away: "home",
    game_result: gameResult,
    score_for: null,
    score_against: null,
    teams: { timezone: "America/Los_Angeles" },
    ...extra,
  };
}

describe("the Team card", () => {
  it("leads with the team's logo, then its own name, its club and season", async () => {
    render(<HomeScreen />);
    const team = await screen.findByLabelText("Team");

    expect(within(team).getByText("12U Girls")).toBeTruthy();
    expect(within(team).getByText("SLOFC · Fall 2026")).toBeTruthy();
    await waitFor(() =>
      expect(within(team).UNSAFE_getAllByType(Image)[0].props.source).toEqual({ uri: LOGO })
    );
  });

  it("a team with no logo shows its initials, and a free team only its season", async () => {
    Object.assign(mockCtx.membership, { logoUrl: null, clubName: null });
    render(<HomeScreen />);
    const team = await screen.findByLabelText("Team");

    expect(within(team).getByText("1G")).toBeTruthy();
    expect(within(team).getByText("Fall 2026")).toBeTruthy();
  });

  it("lists the members by name and role: coaches and staff first, then players by name", async () => {
    render(<HomeScreen />);
    const members = await screen.findByLabelText("Members");

    const rows = within(members).getAllByRole("button");
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      "Dee Park, Director",
      "Sam Okafor, Coach",
      "Max Lee, Manager",
      "Ava Chen, Player",
      "Zoe Young, Player",
    ]);
  });

  it("each member opens their page, and the roster is a tap away", async () => {
    render(<HomeScreen />);
    const members = await screen.findByLabelText("Members");

    fireEvent.press(within(members).getByLabelText("Ava Chen, Player"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/team/m-ava");

    expect(within(card("Team")).getByText(/5 members/)).toBeTruthy();
    fireEvent.press(within(card("Team")).getByText("View roster"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/team");
  });
});

describe("the Record card", () => {
  it("isn't shown until a game has a result", async () => {
    render(<HomeScreen />);
    await screen.findByLabelText("Team");

    expect(screen.queryByLabelText("Record")).toBeNull();
  });

  it("shows the last game as a scoreline, with its date and time", async () => {
    mockTables.results = [
      result("2026-09-13T17:00:00Z", "loss"),
      result("2026-09-20T17:00:00Z", "win", { score_for: 3, score_against: 1 }),
    ];
    render(<HomeScreen />);
    const record = await screen.findByLabelText("Record");

    expect(within(record).getByText("Last game")).toBeTruthy();
    expect(within(record).getByLabelText("12U Girls 3")).toBeTruthy();
    expect(within(record).getByLabelText("vs Rivals FC 1")).toBeTruthy();
    expect(within(record).getByText("Sun, Sep 20, 10:00 AM PDT")).toBeTruthy();
  });

  it("an away game reads 'at' the opponent, and without a score the team's line shows the result", async () => {
    mockTables.results = [result("2026-09-20T17:00:00Z", "tie", { home_away: "away", opponent: "Eagles" })];
    render(<HomeScreen />);
    const record = await screen.findByLabelText("Record");

    expect(within(record).getByLabelText("12U Girls Tie")).toBeTruthy();
    expect(within(record).getByLabelText("at Eagles")).toBeTruthy();
  });

  it("counts wins, losses and ties, with a bar split in those proportions and colors", async () => {
    mockTables.results = [
      result("2026-09-20T17:00:00Z", "win"),
      result("2026-09-13T17:00:00Z", "win"),
      result("2026-09-06T17:00:00Z", "loss"),
      result("2026-08-30T17:00:00Z", "tie"),
    ];
    render(<HomeScreen />);
    const record = await screen.findByLabelText("Record");

    expect(within(record).getByLabelText("2 Wins")).toBeTruthy();
    expect(within(record).getByLabelText("1 Losses")).toBeTruthy();
    expect(within(record).getByLabelText("1 Ties")).toBeTruthy();

    const bar = within(record).getByLabelText("2 wins, 1 loss, 1 tie");
    const segments = bar.props.children.map((c: { props: { style: Record<string, unknown> } }) => c.props.style);
    expect(segments.map((s: Record<string, unknown>) => s.width)).toEqual(["50%", "25%", "25%"]);
    expect(segments.map((s: Record<string, unknown>) => s.backgroundColor)).toEqual(["#C8102E", "#000000", "#a3a3a3"]);
  });

  it("wins are lista blue outside a club", async () => {
    mockCtx.membership.winColor = "#01D7F4";
    mockTables.results = [result("2026-09-20T17:00:00Z", "win")];
    render(<HomeScreen />);
    const bar = within(await screen.findByLabelText("Record")).getByLabelText("1 win, 0 losses, 0 ties");

    expect(bar.props.children[0].props.style.backgroundColor).toBe("#01D7F4");
  });
});
