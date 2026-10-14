// @vitest-environment jsdom
/**
 * Leagues shown on the web (docs/specs/tournaments-and-leagues.md §5; leagues
 * part 2b): a small league tag on league games in the schedule, and the league
 * on a game's page. The Record card's rows are in tournament-dashboard.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, cleanup, within } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const result = () => Promise.resolve({ data: [], error: null, count: 0 });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
  chain.single = result;
  chain.maybeSingle = result;
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
  return {
    fetchEventPage: vi.fn(),
    fetchEventRange: vi.fn(),
    client: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
  fetchEventRange: mocks.fetchEventRange,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ScheduleList } from "@/components/calendar/schedule-list";
import { EventDetail } from "@/components/calendar/event-detail";

const TEAM_ID = "11111111-1111-1111-1111-111111111111";
const LA = "America/Los_Angeles";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

function event(overrides: Record<string, unknown>) {
  return {
    id: "evt",
    team_id: TEAM_ID,
    title: "Game",
    event_type: "game",
    start_time: "2026-12-12T17:00:00.000Z",
    end_time: "2026-12-12T18:30:00.000Z",
    timezone: LA,
    is_cancelled: false,
    location_id: null,
    locations: null,
    arrival_time: null,
    notes: null,
    opponent: "Rivals FC",
    home_away: "home",
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    recurrence_rule: null,
    parent_event_id: null,
    tournament_id: null,
    league_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    league: null,
    games: [],
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

const LEAGUE_GAME = event({ id: "g-1", league_id: "l-1", league: { name: "Division 3", season: "Fall 2026" } });
const FRIENDLY = event({ id: "g-2", opponent: "Eagles", start_time: "2026-12-19T17:00:00.000Z", end_time: "2026-12-19T18:30:00.000Z" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the schedule list", () => {
  const rowOf = (text: string) => screen.getByText(text).closest("tr")!;

  it("tags a league game with its league", async () => {
    mocks.fetchEventPage.mockResolvedValue({ items: [LEAGUE_GAME, FRIENDLY], nextCursor: null, hasNext: false });
    render(<ScheduleList teamId={TEAM_ID} isAdmin timeZone={LA} team={TEAM} />);

    await screen.findByText("U10 Girls vs Rivals FC");
    expect(within(rowOf("U10 Girls vs Rivals FC")).getByText("Fall 2026 Division 3")).toBeTruthy();
    // A game outside any league has no tag.
    expect(within(rowOf("U10 Girls vs Eagles")).queryByText(/Division|Fall 2026/)).toBeNull();
  });

  it("asks for each event's league with the list", () => {
    // The list projection embeds it, so the tag needs no further read.
    return import("@/lib/events/queries").then(({ LIST_PROJECTION }) => {
      expect(LIST_PROJECTION).toContain("league:league_id(name, season)");
    });
  });
});

describe("a game's page", () => {
  function renderGame(ev: unknown) {
    return render(
      <EventDetail
        event={ev as never}
        isAdmin={false}
        creatorName="Coach Kim"
        team={TEAM}
        teamTimeZone={LA}
        currentUserId="me"
        availabilityRows={[]}
        members={[]}
      />
    );
  }

  it("names its league in the game details", () => {
    renderGame(LEAGUE_GAME);

    const details = screen.getByText("Game details").parentElement!;
    expect(within(details).getByText("Fall 2026 Division 3")).toBeTruthy();
    expect(within(details).getByText(/League:/)).toBeTruthy();
  });

  it("says nothing about a league for a game outside one", () => {
    renderGame(FRIENDLY);

    expect(screen.queryByText(/League:/)).toBeNull();
  });

  it("an archived league is still named: it's the game's", () => {
    renderGame({ ...LEAGUE_GAME, league: { name: "Division 4", season: "Fall 2025", archived_at: "2026-01-01T00:00:00Z" } });

    expect(screen.getByText("Fall 2025 Division 4")).toBeTruthy();
  });
});

describe("a game's Home / Away (2026-10-14)", () => {
  it("is a labelled field, like the others", () => {
    render(
      <EventDetail
        event={FRIENDLY as never}
        isAdmin={false}
        creatorName="Coach Kim"
        team={TEAM}
        teamTimeZone={LA}
        currentUserId="me"
        availabilityRows={[]}
        members={[]}
      />
    );

    const label = screen.getByText("Home / Away:");
    expect(within(label.parentElement!).getByText("Home")).toBeTruthy();
  });
});
