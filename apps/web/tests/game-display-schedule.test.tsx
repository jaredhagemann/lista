// @vitest-environment jsdom
/**
 * Games on the schedule list and calendar (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * The list titled games "Home vs X" / "Away @ X" and never showed a uniform; the
 * calendar showed each game's typed title. Both now name a game "[Team] vs
 * [opponent]" or "[Team] @ [opponent]" and show its uniform: the list as a
 * labeled pill, the calendar as a dot with the uniform named in the tooltip.
 * The list's confirmations name a game the same way as its row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  // Radix menus measure and capture pointers; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchEventRange: vi.fn(),
}));

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
const TEAM = {
  name: "U10 Girls",
  home_uniform: "Navy",
  away_uniform: "White",
  home_uniform_color: "#1e3a8a",
  away_uniform_color: "#ffffff",
};

function event(overrides: Record<string, unknown>) {
  return {
    id: "evt-1",
    team_id: TEAM_ID,
    title: "Saturday game",
    event_type: "game",
    start_time: "2026-12-12T17:00:00.000Z",
    end_time: "2026-12-12T18:30:00.000Z",
    timezone: "America/Los_Angeles",
    is_cancelled: false,
    location_id: null,
    locations: null,
    arrival_time: null,
    notes: null,
    opponent: "Rivals FC",
    home_away: "home",
    uniform: "home",
    game_result: null,
    score_for: null,
    score_against: null,
    recurrence_rule: null,
    parent_event_id: null,
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

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
    return render(<ScheduleList teamId={TEAM_ID} isAdmin timeZone="America/Los_Angeles" team={TEAM} />);
  }

  it("names home and away games by the team and opponent", async () => {
    renderList([
      event({ id: "home-1" }),
      event({ id: "away-1", home_away: "away", uniform: "away", opponent: "Eagles" }),
    ]);

    expect(await screen.findByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(screen.getByText("U10 Girls @ Eagles")).toBeTruthy();
    expect(screen.queryByText(/Home vs|Away @/)).toBeNull();
  });

  it("keeps the score, and keeps the typed title without an opponent or for a practice", async () => {
    renderList([
      event({ id: "scored", score_for: 0, score_against: 0 }),
      event({ id: "no-opponent", opponent: null, title: "Scrimmage" }),
      event({ id: "practice", event_type: "practice", title: "Evening practice", opponent: null, uniform: null }),
    ]);

    expect(await screen.findByText("U10 Girls vs Rivals FC · 0–0")).toBeTruthy();
    expect(screen.getByText("Scrimmage")).toBeTruthy();
    expect(screen.getByText("Evening practice")).toBeTruthy();
  });

  it("shows each game's uniform by name, in its color", async () => {
    renderList([event({ id: "home-1" }), event({ id: "away-1", home_away: "away", uniform: "away" })]);

    const navy = (await screen.findAllByLabelText("Uniform: Navy"))[0];
    expect(navy.style.backgroundColor).toBe("rgb(30, 58, 138)");
    expect(screen.getAllByLabelText("Uniform: White").length).toBeGreaterThan(0);
  });

  it("the delete confirmation names the game as its row does", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderList([event({ id: "home-1" })]);

    await user.click(await screen.findByRole("button", { name: /actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/U10 Girls vs Rivals FC/)).toBeTruthy();
  });
});

// ── Calendar ──────────────────────────────────────────────────────────────────

describe("schedule calendar", () => {
  function renderCalendar(items: unknown[]) {
    mocks.fetchEventRange.mockResolvedValue(items);
    return render(
      <ScheduleCalendar
        teamId={TEAM_ID}
        isAdmin={false}
        timeZone="America/Los_Angeles"
        month="2026-12"
        onMonthChange={vi.fn()}
        team={TEAM}
      />
    );
  }

  it("names a game by the team and opponent, without its score", async () => {
    renderCalendar([
      event({ id: "home-1", score_for: 3, score_against: 1 }),
      event({ id: "away-1", home_away: "away", uniform: "away", opponent: "Eagles", start_time: "2026-12-19T17:00:00.000Z" }),
    ]);

    expect(await screen.findByText("U10 Girls vs Rivals FC")).toBeTruthy();
    expect(screen.getByText("U10 Girls @ Eagles")).toBeTruthy();
    expect(screen.queryByText(/3–1/)).toBeNull();
  });

  it("marks a game's uniform with a dot, and names it in the tooltip", async () => {
    renderCalendar([event({ id: "home-1" })]);

    const chip = (await screen.findByText("U10 Girls vs Rivals FC")).closest("button")!;
    expect(chip.getAttribute("title")).toBe("U10 Girls vs Rivals FC · Navy");
    expect(within(chip).getByLabelText("Uniform: Navy").style.backgroundColor).toBe("rgb(30, 58, 138)");
  });

  it("no dot for a uniform without a color, or a game without a uniform", async () => {
    renderCalendar([
      event({ id: "no-uniform", uniform: null }),
      event({ id: "practice", event_type: "practice", title: "Evening practice", opponent: null, uniform: null, start_time: "2026-12-19T17:00:00.000Z" }),
    ]);

    const chip = (await screen.findByText("U10 Girls vs Rivals FC")).closest("button")!;
    expect(within(chip).queryByLabelText(/Uniform:/)).toBeNull();
    expect(screen.getByText("Evening practice")).toBeTruthy();
  });
});
