// @vitest-environment jsdom
/**
 * Tournaments on the schedule list and calendar
 * (docs/specs/tournaments-and-leagues.md §4, "Multi-day events in queries").
 *
 *   - list: the tournament is one row at its start, with its dates (not times)
 *     and its game count, marked "Now" while underway; each game is its own row
 *     with "Surf Cup · Semifinal" under it. Nothing is nested, so it doesn't
 *     matter which page each lands on.
 *   - calendar: the tournament runs across each of its days, as one connected
 *     bar, named on its first day and at the start of each week it continues
 *     into; its games sit on their own days.
 *   - managing a tournament from the list (edit, cancel, delete) comes in part
 *     2b, so a tournament row has no row actions yet.
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

const mocks = vi.hoisted(() => ({ fetchEventPage: vi.fn(), fetchEventRange: vi.fn() }));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
  fetchEventRange: mocks.fetchEventRange,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ScheduleList } from "@/components/calendar/schedule-list";
import { ScheduleCalendar } from "@/components/calendar/schedule-calendar";

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
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    games: [],
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

// Fri Dec 11 – Sun Dec 13, 2026, Pacific (PST, UTC−8): midnight Dec 11 to midnight Dec 14.
const SURF_CUP = event({
  id: "t-1",
  title: "Surf Cup",
  event_type: "tournament",
  start_time: "2026-12-11T08:00:00.000Z",
  end_time: "2026-12-14T08:00:00.000Z",
  opponent: null,
  home_away: null,
  games: [{ count: 3 }],
});
const SEMIFINAL = event({ id: "g-1", tournament_id: "t-1", round: "Semifinal", tournament: { title: "Surf Cup" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── List ──────────────────────────────────────────────────────────────────────

describe("schedule list", () => {
  function renderList(items: unknown[]) {
    mocks.fetchEventPage.mockResolvedValue({ items, nextCursor: null, hasNext: false });
    return render(<ScheduleList teamId={TEAM_ID} isAdmin timeZone={LA} team={TEAM} />);
  }

  const rowOf = (text: string) => screen.getByText(text).closest("tr")!;

  it("shows a tournament as one row with its dates and game count", async () => {
    renderList([SURF_CUP, SEMIFINAL]);

    await screen.findByText("Surf Cup");
    const row = rowOf("Surf Cup");
    expect(within(row).getAllByText("Fri, Dec 11 – Sun, Dec 13").length).toBeGreaterThan(0);
    expect(within(row).getByText("3 games")).toBeTruthy();
    expect(within(row).getByText("Tournament")).toBeTruthy();
    expect(within(row).queryByText(/AM|PM/)).toBeNull();
  });

  it("names a game's tournament and round under it", async () => {
    renderList([SURF_CUP, SEMIFINAL]);

    await screen.findByText("Surf Cup");
    const row = rowOf("U10 Girls vs Rivals FC");
    expect(within(row).getByText("Surf Cup · Semifinal")).toBeTruthy();
  });

  it("marks a tournament underway as Now", async () => {
    vi.setSystemTime(new Date("2026-12-12T20:00:00.000Z"));
    renderList([SURF_CUP]);

    await screen.findByText("Surf Cup");
    expect(within(rowOf("Surf Cup")).getByText("Now")).toBeTruthy();
  });

  it("offers no row actions on a tournament yet, and keeps them on its games", async () => {
    renderList([SURF_CUP, SEMIFINAL]);

    await screen.findByText("Surf Cup");
    expect(within(rowOf("Surf Cup")).queryByRole("button", { name: /actions/i })).toBeNull();
    expect(within(rowOf("U10 Girls vs Rivals FC")).getByRole("button", { name: /actions/i })).toBeTruthy();
  });

  it("can be filtered to tournaments", async () => {
    renderList([SURF_CUP]);

    expect(await screen.findByRole("button", { name: "Tournament" })).toBeTruthy();
  });
});

// ── Calendar ──────────────────────────────────────────────────────────────────

describe("schedule calendar", () => {
  function renderCalendar(items: unknown[]) {
    mocks.fetchEventRange.mockResolvedValue(items);
    return render(
      <ScheduleCalendar teamId={TEAM_ID} isAdmin={false} timeZone={LA} month="2026-12" onMonthChange={vi.fn()} team={TEAM} />
    );
  }

  const cell = (key: string) => document.querySelector(`[data-day="${key}"]`) as HTMLElement;

  it("runs a tournament across each of its days, and no further", async () => {
    renderCalendar([SURF_CUP]);
    await screen.findAllByText("Surf Cup");

    for (const day of ["2026-12-11", "2026-12-12", "2026-12-13"]) {
      expect(within(cell(day)).getAllByTitle("Surf Cup · Fri, Dec 11 – Sun, Dec 13").length).toBeGreaterThan(0);
    }
    expect(within(cell("2026-12-10")).queryAllByTitle(/Surf Cup/)).toHaveLength(0);
    expect(within(cell("2026-12-14")).queryAllByTitle(/Surf Cup/)).toHaveLength(0);
  });

  it("names it on its first day, and again when it continues into a new week", async () => {
    // Sat Dec 12 – Mon Dec 14: it continues into the week starting Sunday Dec 13.
    renderCalendar([{ ...SURF_CUP, start_time: "2026-12-12T08:00:00.000Z", end_time: "2026-12-15T08:00:00.000Z" }]);
    await screen.findAllByText("Surf Cup");

    expect(within(cell("2026-12-12")).getByText("Surf Cup")).toBeTruthy();
    expect(within(cell("2026-12-13")).getByText("Surf Cup")).toBeTruthy();
    expect(within(cell("2026-12-14")).queryByText("Surf Cup")).toBeNull();
  });

  it("puts its games on their own days", async () => {
    renderCalendar([SURF_CUP, SEMIFINAL]);
    await screen.findAllByText("Surf Cup");

    expect(within(cell("2026-12-12")).getByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(within(cell("2026-12-11")).queryByText("U10 Girls vs Rivals FC")).toBeNull();
  });
});
