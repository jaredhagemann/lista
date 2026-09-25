// @vitest-environment jsdom
/**
 * A game on its event page and in the event forms
 * (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * The page's heading and every confirmation name a game "[Team] vs/@ [opponent]"
 * (a whole series without a score); the uniform shows by name and color, and
 * home/away as people say it. The forms explain when the typed title is used and
 * preview what the schedule will show. The series-edit review names uniforms and
 * home/away by what people see, not the stored values.
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

import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  // Every query resolves to the rows configured for its table.
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
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

import { EventDetail, EventEditForm } from "@/components/calendar/event-detail";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { describeSeriesValue } from "@/components/calendar/series-edit-form";

const TEAM = {
  name: "U10 Girls",
  home_uniform: "Navy",
  away_uniform: null,
  home_uniform_color: "#1e3a8a",
  away_uniform_color: "#ffffff",
};

const GAME = {
  id: "evt-1",
  team_id: "team-1",
  title: "Saturday game",
  event_type: "game",
  start_time: "2026-12-12T17:00:00+00:00",
  end_time: "2026-12-12T18:30:00+00:00",
  timezone: "America/Los_Angeles",
  is_cancelled: false,
  location_id: null,
  locations: null,
  arrival_time: null,
  notes: null,
  opponent: "Rivals FC",
  home_away: "home",
  uniform: "home",
  game_result: "win",
  score_for: 2,
  score_against: 1,
  recurrence_rule: null,
  parent_event_id: null,
  created_by: "coach-1",
  created_at: null,
};

function renderDetail(overrides: Record<string, unknown> = {}) {
  return render(
    <EventDetail
      event={{ ...GAME, ...overrides }}
      isAdmin
      creatorName="Coach Casey"
      team={TEAM}
      teamTimeZone="America/Los_Angeles"
      currentUserId="coach-1"
      availabilityRows={[]}
      members={[]}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
});

afterEach(cleanup);

// ── Event page ────────────────────────────────────────────────────────────────

describe("event page", () => {
  it("heads a game by the team and opponent, with its score", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "U10 Girls vs Rivals FC · 2–1" })).toBeTruthy();
  });

  it("an away game reads '@', and a game without an opponent keeps its title", () => {
    const { unmount } = renderDetail({ home_away: "away" });
    expect(screen.getByRole("heading", { name: "U10 Girls @ Rivals FC · 2–1" })).toBeTruthy();
    unmount();

    renderDetail({ opponent: null });
    expect(screen.getByRole("heading", { name: "Saturday game" })).toBeTruthy();
  });

  it("shows the uniform by name and color, and home/away as people say it", () => {
    renderDetail();

    const uniform = screen.getByLabelText("Uniform: Navy");
    expect(uniform.style.backgroundColor).toBe("rgb(30, 58, 138)");
    expect(screen.queryByText("home")).toBeNull();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("an unnamed uniform shows as 'Away uniform'", () => {
    renderDetail({ uniform: "away" });

    expect(screen.getByLabelText("Uniform: Away uniform")).toBeTruthy();
  });

  it("the cancel confirmation names the game as the heading does", async () => {
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Cancel this event" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/U10 Girls vs Rivals FC · 2–1/)).toBeTruthy();
  });

  it("the restore confirmation too", async () => {
    renderDetail({ is_cancelled: true });

    fireEvent.click(screen.getByRole("button", { name: "Restore this event" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/U10 Girls vs Rivals FC · 2–1/)).toBeTruthy();
  });

  it("the delete confirmation too", async () => {
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Delete event" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/U10 Girls vs Rivals FC · 2–1/)).toBeTruthy();
  });

  it("deleting a whole series names it without a score", async () => {
    const series = { ...GAME, recurrence_rule: "DTSTART:20261212T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=SA" };
    mocks.tables.events = [series];
    render(
      <EventDetail
        event={series}
        isAdmin
        creatorName="Coach Casey"
        team={TEAM}
        teamTimeZone="America/Los_Angeles"
        currentUserId="coach-1"
        availabilityRows={[]}
        members={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
    fireEvent.click(await screen.findByRole("button", { name: /entire series/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/U10 Girls vs Rivals FC.{1,3}series/)).toBeTruthy();
    expect(within(dialog).queryByText(/2–1/)).toBeNull();
  });
});

// ── Forms ─────────────────────────────────────────────────────────────────────

describe("the Title field", () => {
  function renderEdit(overrides: Record<string, unknown> = {}) {
    return render(
      <EventEditForm
        editingEvent={{ ...GAME, ...overrides }}
        teamId="team-1"
        timeZone="America/Los_Angeles"
        teamTimeZone="America/Los_Angeles"
        team={TEAM}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
  }

  it("for a game, explains when the title is used and previews what the schedule shows", () => {
    renderEdit();

    expect(screen.getByText(/This title is used when there's no opponent/)).toBeTruthy();
    expect(screen.getByTestId("game-title-preview").textContent).toBe("Shown as: U10 Girls vs Rivals FC");
  });

  it("the preview follows the opponent, and falls back to the title without one", () => {
    renderEdit();

    fireEvent.change(screen.getByLabelText("Opponent"), { target: { value: "Eagles" } });
    expect(screen.getByTestId("game-title-preview").textContent).toBe("Shown as: U10 Girls vs Eagles");

    fireEvent.change(screen.getByLabelText("Opponent"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tournament final" } });
    expect(screen.getByTestId("game-title-preview").textContent).toBe("Shown as: Tournament final");
  });

  it("an away game previews with '@'", () => {
    renderEdit({ home_away: "away" });

    expect(screen.getByTestId("game-title-preview").textContent).toBe("Shown as: U10 Girls @ Rivals FC");
  });

  it("practices show neither", () => {
    renderEdit({ event_type: "practice", opponent: null, uniform: null, home_away: null });

    expect(screen.queryByTestId("game-title-preview")).toBeNull();
    expect(screen.queryByText(/This title is used when/)).toBeNull();
  });

  it("the create form shows them once the type is Game", async () => {
    const user = userEvent.setup();
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone="America/Los_Angeles" team={TEAM} />);
    expect(screen.queryByTestId("game-title-preview")).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Game" }));
    await user.type(screen.getByLabelText("Opponent"), "Rivals FC");

    expect(screen.getByTestId("game-title-preview").textContent).toBe("Shown as: U10 Girls vs Rivals FC");
  });
});

// ── Series-edit review ────────────────────────────────────────────────────────

describe("the series-edit review", () => {
  it("names uniforms by what the team calls them", () => {
    expect(describeSeriesValue("uniform", "home", { team: TEAM, locations: [] })).toBe("Navy");
    expect(describeSeriesValue("uniform", "away", { team: TEAM, locations: [] })).toBe("Away uniform");
  });

  it("names home and away as people say them", () => {
    expect(describeSeriesValue("home_away", "home", { team: TEAM, locations: [] })).toBe("Home");
    expect(describeSeriesValue("home_away", "away", { team: TEAM, locations: [] })).toBe("Away");
  });

  it("shows an empty value as a dash, and other fields as they are", () => {
    expect(describeSeriesValue("uniform", null, { team: TEAM, locations: [] })).toBe("—");
    expect(describeSeriesValue("opponent", "Eagles", { team: TEAM, locations: [] })).toBe("Eagles");
  });
});
