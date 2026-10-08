// @vitest-environment jsdom
/**
 * The coach's availability grid, with tournaments (docs/specs/tournaments-and-
 * leagues.md §4, "Availability"): a column for the tournament, and one per game
 * showing the resulting answer, inherited ones marked apart from answers set
 * for the game.
 *
 *   - a game's cell is its own answer, else its tournament's
 *   - the tournament's answers are read even when its column is on another page
 *   - Total Available counts resulting answers
 *   - changing a game's cell sets an answer for the game; clearing it goes back
 *     to the tournament's
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchResponsesForEvents: vi.fn(),
  fetchTeamRoster: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
}));
vi.mock("@/lib/availability/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability/queries")>()),
  fetchResponsesForEvents: mocks.fetchResponsesForEvents,
  fetchTeamRoster: mocks.fetchTeamRoster,
}));
vi.mock("@/lib/supabase/client", () => {
  const client = {
    from: () => ({
      upsert: mocks.upsert,
      delete: () => ({ eq: () => ({ eq: mocks.del }) }),
    }),
    rpc: mocks.rpc,
  };
  return { createClient: () => client };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AvailabilityMatrix } from "@/components/availability/availability-matrix";

const TEAM = "11111111-1111-1111-1111-111111111111";
const AVA = "22222222-2222-2222-2222-222222222222";
const ZOEY = "33333333-3333-3333-3333-333333333333";
const TOURNAMENT = "aaaaaaaa-0000-0000-0000-00000000000t";
const GAME = "aaaaaaaa-0000-0000-0000-00000000000g";
const SOLO = "aaaaaaaa-0000-0000-0000-00000000000s";

const base = { team_id: TEAM, is_cancelled: false, timezone: "UTC", opponent: null, home_away: null, uniform: null, score_for: null, score_against: null };
const SURF_CUP = {
  ...base,
  id: TOURNAMENT,
  title: "Surf Cup",
  event_type: "tournament",
  tournament_id: null,
  start_time: "2099-01-09T00:00:00.000Z",
  end_time: "2099-01-12T00:00:00.000Z",
};
const POOL_GAME = {
  ...base,
  id: GAME,
  title: "Pool A",
  event_type: "game",
  tournament_id: TOURNAMENT,
  start_time: "2099-01-09T17:00:00.000Z",
  end_time: "2099-01-09T18:30:00.000Z",
};
const SOLO_GAME = {
  ...base,
  id: SOLO,
  title: "Friendly",
  event_type: "game",
  tournament_id: null,
  start_time: "2099-01-20T17:00:00.000Z",
  end_time: "2099-01-20T18:30:00.000Z",
};

const page = (items: unknown[]) => ({ items, nextCursor: null, hasNext: false });
const cell = (eventId: string, profileId: string) =>
  document.querySelector(`[data-cell="${eventId}:${profileId}"]`) as HTMLElement;
/** The answer chip's title: the innermost titled element, inside the cell's cycle button. */
const chipTitle = (eventId: string, profileId: string) => {
  const titled = cell(eventId, profileId)?.querySelectorAll("[title]");
  return titled && titled.length > 0 ? titled[titled.length - 1].getAttribute("title") : null;
};

const user = userEvent.setup({ pointerEventsCheck: 0 });

function renderMatrix(isAdmin = true, currentUserId = AVA) {
  return render(<AvailabilityMatrix teamId={TEAM} currentUserId={currentUserId} isAdmin={isAdmin} timeZone="UTC" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEventPage.mockResolvedValue(page([SURF_CUP, POOL_GAME, SOLO_GAME]));
  mocks.fetchTeamRoster.mockResolvedValue([
    { profileId: AVA, name: "Ava Smith", role: "player" },
    { profileId: ZOEY, name: "Zoey Butler", role: "player" },
  ]);
  mocks.fetchResponsesForEvents.mockResolvedValue([
    { event_id: TOURNAMENT, profile_id: AVA, status: "available" },
    { event_id: TOURNAMENT, profile_id: ZOEY, status: "available" },
    { event_id: GAME, profile_id: ZOEY, status: "unavailable" },
  ]);
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.del.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: 0, error: null });
});

afterEach(cleanup);

describe("the grid, with a tournament and its game", () => {
  it("shows the tournament's answers in its column, unmarked", async () => {
    renderMatrix();

    await waitFor(() => expect(chipTitle(TOURNAMENT, AVA)).toBe("Available"));
    expect(chipTitle(TOURNAMENT, ZOEY)).toBe("Available");
  });

  it("shows a game's resulting answer: inherited, or set for the game", async () => {
    renderMatrix();

    await waitFor(() => expect(chipTitle(GAME, AVA)).toBe("Available · from the tournament"));
    expect(chipTitle(GAME, ZOEY)).toBe("Unavailable · set for this game");
    // A standalone game is as before.
    expect(chipTitle(SOLO, AVA)).toBe("No response");
  });

  it("counts resulting answers in Total Available", async () => {
    renderMatrix();

    await waitFor(() => expect(chipTitle(GAME, AVA)).toBeTruthy());
    const totals = document.querySelector("tbody")!.textContent!;
    // Surf Cup 2, its game 1 (Ava, inherited), the friendly 0.
    expect(totals).toMatch(/Total Available\s*210/);
  });

  it("reads the tournament's answers when its column is on another page", async () => {
    mocks.fetchEventPage.mockResolvedValue(page([POOL_GAME]));
    renderMatrix();

    await waitFor(() => expect(chipTitle(GAME, AVA)).toBe("Available · from the tournament"));
    const [, ids] = mocks.fetchResponsesForEvents.mock.calls[0];
    expect(ids).toEqual([GAME, TOURNAMENT]);
  });

  it("changing a game's inherited cell sets an answer for the game", async () => {
    renderMatrix();
    await waitFor(() => expect(chipTitle(GAME, AVA)).toBe("Available · from the tournament"));

    await user.click(within(cell(GAME, AVA)).getByRole("button"));

    await waitFor(() =>
      expect(mocks.upsert).toHaveBeenCalledWith(
        { event_id: GAME, profile_id: AVA, status: "available" },
        { onConflict: "event_id,profile_id" }
      )
    );
    expect(chipTitle(GAME, AVA)).toBe("Available · set for this game");
  });

  it("clearing a game's own answer goes back to the tournament's", async () => {
    renderMatrix();
    await waitFor(() => expect(chipTitle(GAME, ZOEY)).toBe("Unavailable · set for this game"));

    // Unavailable is last in the cycle: the next click clears it.
    await user.click(within(cell(GAME, ZOEY)).getByRole("button"));

    await waitFor(() => expect(mocks.del).toHaveBeenCalled());
    expect(chipTitle(GAME, ZOEY)).toBe("Available · from the tournament");
  });

  it("a changed tournament answer flows to its game's inherited cells", async () => {
    renderMatrix();
    await waitFor(() => expect(chipTitle(GAME, AVA)).toBe("Available · from the tournament"));

    // Available → Maybe on the tournament.
    await user.click(within(cell(TOURNAMENT, AVA)).getByRole("button"));

    await waitFor(() => expect(chipTitle(GAME, AVA)).toBe("Maybe · from the tournament"));
    // Zoey's own game answer is untouched.
    expect(chipTitle(GAME, ZOEY)).toBe("Unavailable · set for this game");
  });
});
