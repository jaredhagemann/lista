// @vitest-environment jsdom
/**
 * BUG-033: a game's result can be cleared once set (docs/bugs/fixed/033-game-result-cannot-be-cleared.md).
 *
 * The game's edit form offers "No result" beside Win, Loss and Tie. Choosing it
 * saves no result, and leaves the scores as they are (decided 2026-10-15).
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

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.update = (values: Record<string, unknown>) => {
      if (table === "events") updates.push(values);
      return chain;
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    updates,
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
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

import { EventEditForm } from "@/components/calendar/event-detail";

const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

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
  uniform: null,
  game_result: "win",
  score_for: 2,
  score_against: 1,
  recurrence_rule: null,
  parent_event_id: null,
  tournament_id: null,
  league_id: null,
  round: null,
  placement_rank: null,
  placement_label: null,
  created_by: "coach-1",
  created_at: null,
};

function renderEdit(overrides: Record<string, unknown> = {}) {
  const onSave = vi.fn();
  render(
    <EventEditForm
      editingEvent={{ ...GAME, ...overrides } as never}
      teamId="team-1"
      timeZone="America/Los_Angeles"
      teamTimeZone="America/Los_Angeles"
      team={TEAM}
      onSave={onSave}
      onCancel={() => {}}
    />
  );
  return onSave;
}

/** The Result select's trigger: the one showing the game's current result. */
function resultTrigger(current: string) {
  const trigger = screen.getAllByRole("combobox").find((el) => el.textContent === current);
  if (!trigger) throw new Error(`no select showing "${current}"`);
  return trigger;
}

async function chooseResult(current: string, option: string) {
  const user = userEvent.setup();
  await user.click(resultTrigger(current));
  await user.click(await screen.findByRole("option", { name: option }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
});

afterEach(cleanup);

describe("BUG-033: clearing a game's result", () => {
  it("choosing No result saves no result, and leaves the scores", async () => {
    const onSave = renderEdit();

    await chooseResult("Win", "No result");

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({ game_result: null, score_for: 2, score_against: 1 });
  });

  it("a game with no result shows No result", () => {
    renderEdit({ game_result: null, score_for: null, score_against: null });

    expect(resultTrigger("No result")).toBeTruthy();
  });

  it("choosing another result still saves it", async () => {
    const onSave = renderEdit();

    await chooseResult("Win", "Loss");

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates[0]).toMatchObject({ game_result: "loss" });
  });
});
