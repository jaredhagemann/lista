// @vitest-environment jsdom
/**
 * A tournament's page, and a game's link to it (docs/specs/tournaments-and-leagues.md §4).
 *
 *   - a tournament shows its dates (whole days, not times), its placement once
 *     set, its own record, and its games in order, each linking to its page
 *     with its round and result
 *   - a game in a tournament says "Part of Surf Cup · Semifinal", linking back
 *   - people still answer for the tournament on its page (D2)
 *   - editing, cancelling and deleting a tournament come in part 2b, so its page
 *     offers none of the single-event controls, which would act on the
 *     tournament alone
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, cleanup, within } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const from = () => {
    const result = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { EventDetail } from "@/components/calendar/event-detail";

const LA = "America/Los_Angeles";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

function event(overrides: Record<string, unknown>) {
  return {
    id: "evt",
    team_id: "team-1",
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
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

// Fri Dec 11 – Sun Dec 13, 2026, Pacific.
const SURF_CUP = event({
  id: "t-1",
  title: "Surf Cup",
  event_type: "tournament",
  start_time: "2026-12-11T08:00:00.000Z",
  end_time: "2026-12-14T08:00:00.000Z",
  opponent: null,
  home_away: null,
  locations: { name: "Del Mar Fields", address: null },
});

const GAMES = [
  event({ id: "g-1", tournament_id: "t-1", round: "Pool A", start_time: "2026-12-11T17:00:00.000Z", game_result: "win", score_for: 3, score_against: 1 }),
  event({ id: "g-2", tournament_id: "t-1", round: "Semifinal", opponent: "Eagles", home_away: "away", start_time: "2026-12-12T17:00:00.000Z", game_result: "loss", score_for: 0, score_against: 2 }),
  event({ id: "g-3", tournament_id: "t-1", round: "Consolation", opponent: "Hawks", start_time: "2026-12-13T17:00:00.000Z" }),
];

function renderPage(ev: unknown, extra: Record<string, unknown> = {}) {
  return render(
    <EventDetail
      event={ev as never}
      isAdmin
      creatorName="Coach Kim"
      team={TEAM}
      teamTimeZone={LA}
      currentUserId="coach-1"
      availabilityRows={[]}
      members={[{ profileId: "coach-1", name: "Coach Kim", role: "coach" }]}
      {...extra}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a tournament's page", () => {
  it("shows its dates, not times", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(screen.getByText("Fri, Dec 11 – Sun, Dec 13")).toBeTruthy();
    // Not as a time range: an all-day tournament would read "12:00 AM – 12:00 AM".
    expect(screen.queryByText(/12:00 AM/)).toBeNull();
    expect(screen.getByText("Del Mar Fields")).toBeTruthy();
  });

  it("lists its games in order, each with its round and result, linking to its page", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    const list = screen.getByRole("list", { name: "Games" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/schedule/g-1",
      "/dashboard/schedule/g-2",
      "/dashboard/schedule/g-3",
    ]);
    expect(links[0].textContent).toContain("U10 Girls vs Rivals FC · 3–1");
    expect(links[0].textContent).toContain("Pool A");
    expect(links[1].textContent).toContain("U10 Girls @ Eagles · 0–2");
    expect(links[2].textContent).toContain("Consolation");
  });

  it("shows its own record, and its placement once set", () => {
    renderPage({ ...SURF_CUP, placement_rank: 3 }, { tournamentGames: GAMES });

    expect(screen.getByLabelText("Tournament record").textContent).toBe("1–1–0");
    expect(screen.getByText("3rd place")).toBeTruthy();
  });

  it("shows no record or placement before there's one", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES.map((g) => ({ ...g, game_result: null })) });

    expect(screen.queryByLabelText("Tournament record")).toBeNull();
    expect(screen.queryByText(/place$/)).toBeNull();
  });

  it("still lets people answer for it, all through the days it runs", () => {
    // Saturday afternoon: underway. A tournament is past when it ends, not when it starts.
    vi.setSystemTime(new Date("2026-12-12T22:00:00.000Z"));
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(screen.getByRole("group", { name: /availability/i })).toBeTruthy();
  });

  it("offers none of the single-event edit, cancel or delete controls yet", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel this event/i })).toBeNull();
  });
});

// ── Review findings on PR #116 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ──

describe("TL-008: the edit link doesn't open the single-event editor for a tournament", () => {
  it("a tournament opened with ?edit=true shows its page, not the event editor", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES, initialEdit: true });

    expect(screen.queryByText("Edit event")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("list", { name: "Games" })).toBeTruthy();
  });

  it("a game opened with ?edit=true still opens the editor", () => {
    renderPage(GAMES[0], { initialEdit: true });

    expect(screen.getByText("Edit event")).toBeTruthy();
  });
});

describe("TL-011: each game's result shows, with or without a score", () => {
  function rowFor(id: string) {
    const list = screen.getByRole("list", { name: "Games" });
    return within(list).getAllByRole("link").find((a) => a.getAttribute("href") === `/dashboard/schedule/${id}`)!;
  }

  it("a result entered without a score", () => {
    renderPage(SURF_CUP, {
      tournamentGames: [
        { ...GAMES[0], id: "w", game_result: "win", score_for: null, score_against: null },
        { ...GAMES[1], id: "l", game_result: "loss", score_for: null, score_against: null },
        { ...GAMES[2], id: "t", game_result: "tie", score_for: null, score_against: null },
      ],
    });

    expect(within(rowFor("w")).getByText("Win")).toBeTruthy();
    expect(within(rowFor("l")).getByText("Loss")).toBeTruthy();
    expect(within(rowFor("t")).getByText("Tie")).toBeTruthy();
  });

  it("a scored game shows its result and its score", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(within(rowFor("g-1")).getByText("Win")).toBeTruthy();
    expect(rowFor("g-1").textContent).toContain("3–1");
  });

  it("a game with neither shows no result", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(within(rowFor("g-3")).queryByText(/^(Win|Loss|Tie)$/)).toBeNull();
  });
});

describe("a game in a tournament", () => {
  it("links back to its tournament, with its round", () => {
    renderPage({ ...GAMES[1], tournament: { id: "t-1", title: "Surf Cup" } });

    const link = screen.getByRole("link", { name: "Surf Cup" });
    expect(link.getAttribute("href")).toBe("/dashboard/schedule/t-1");
    expect(link.parentElement!.textContent).toBe("Part of Surf Cup · Semifinal");
  });

  it("a game outside a tournament says nothing about one", () => {
    renderPage(event({ id: "solo" }));

    expect(screen.queryByText(/Part of/)).toBeNull();
  });
});
