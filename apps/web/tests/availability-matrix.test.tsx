// @vitest-environment jsdom
/**
 * The availability matrix after pagination (BUG-014, spec §7).
 *
 * It used to receive every event in a two-year window and every response to all
 * of them, then slice the result in the browser. Past the API's row cap the
 * responses were silently dropped, and a dropped response renders as "no
 * response" — indistinguishable from a player who never replied.
 *
 * The behaviours pinned here are the ones that made the earlier attempt unsafe:
 * a cell that has not been read must not claim "no response"; a window change
 * must reconcile the response map rather than keep the old one; and an edit must
 * survive a read that was already in flight when it was made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchResponsesForEvents: vi.fn(),
  fetchTeamRoster: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  toastError: vi.fn(),
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
  };
  return { createClient: () => client };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError, info: vi.fn() },
}));

import { AvailabilityMatrix } from "@/components/availability/availability-matrix";

const TEAM = "11111111-1111-1111-1111-111111111111";
const PLAYER = "22222222-2222-2222-2222-222222222222";

const upcomingEvent = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  team_id: TEAM,
  title: "Practice",
  event_type: "practice",
  start_time: "2099-01-05T18:00:00.000Z",
  end_time: "2099-01-05T19:00:00.000Z",
  is_cancelled: false,
};
const laterEvent = {
  ...upcomingEvent,
  id: "aaaaaaaa-0000-0000-0000-000000000002",
  start_time: "2099-06-05T18:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function eventPage(items: unknown[], hasNext = false) {
  return { items, nextCursor: hasNext ? { startTime: "x", id: "y" } : null, hasNext };
}

function cell(eventId: string, profileId: string) {
  return document.querySelector(`[data-cell="${eventId}:${profileId}"]`) as HTMLElement | null;
}

// Radix marks the page pointer-events: none while a select is open, which the
// default pointer check refuses to click through.
const user = userEvent.setup({ pointerEventsCheck: 0 });

function renderMatrix() {
  return render(
    <AvailabilityMatrix teamId={TEAM} currentUserId={PLAYER} isAdmin={false} timeZone="UTC" />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEventPage.mockResolvedValue(eventPage([upcomingEvent]));
  mocks.fetchResponsesForEvents.mockResolvedValue([]);
  mocks.fetchTeamRoster.mockResolvedValue([
    { profileId: PLAYER, name: "Zoey Butler", role: "player" },
  ]);
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.del.mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe("what the matrix reads", () => {
  it("asks for one page of events and the responses for exactly those", async () => {
    mocks.fetchEventPage.mockResolvedValue(eventPage([upcomingEvent, laterEvent]));

    renderMatrix();

    await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalled());
    const [, ids] = mocks.fetchResponsesForEvents.mock.calls[0];
    expect(ids).toEqual([upcomingEvent.id, laterEvent.id]);

    const [, args] = mocks.fetchEventPage.mock.calls[0];
    expect(args.pageSize).toBe(10);
    // Cancelled events stay visible in the matrix, unlike the calendar.
    expect(args.query.includeCancelled).toBe(true);
  });
});

describe("a cell that has not been read", () => {
  it("shows nothing at all until the responses have arrived", async () => {
    const pending = deferred<unknown[]>();
    mocks.fetchResponsesForEvents.mockReturnValue(pending.promise);

    renderMatrix();

    // The page is ready only once the events, the roster and the responses
    // have all succeeded (spec §7.1). A dash means "did not reply", so it
    // cannot appear for a response nobody has read yet.
    await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalled());
    expect(screen.queryByTitle("No response")).toBeNull();

    pending.resolve([]);
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("No response")).toBeTruthy()
    );
  });

  it("says a read failed rather than showing an empty matrix", async () => {
    mocks.fetchResponsesForEvents.mockRejectedValue(new Error("network"));

    renderMatrix();

    await waitFor(() => expect(screen.getByText(/Couldn't load availability/)).toBeTruthy());
    expect(screen.queryByTitle("No response")).toBeNull();
    // The controls stay usable so the reader can retry or change the range.
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });
});

describe("changing the window", () => {
  it("reconciles the responses instead of keeping the old ones", async () => {
    // Upcoming: no answer recorded. The wider range holds an Unavailable for the
    // same player — the case where the old matrix showed "no response" and a
    // bulk action then overwrote a real answer.
    mocks.fetchResponsesForEvents.mockResolvedValueOnce([]);
    mocks.fetchResponsesForEvents.mockResolvedValue([
      { event_id: upcomingEvent.id, profile_id: PLAYER, status: "unavailable" },
    ]);

    renderMatrix();
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("No response")).toBeTruthy()
    );

    await user.click(screen.getByRole("button", { name: "Wider range" }));

    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("Unavailable")).toBeTruthy()
    );
  });

  it("asks for the new range, from the first page", async () => {
    mocks.fetchEventPage.mockResolvedValue(eventPage([upcomingEvent], true));

    renderMatrix();
    await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "More events" }));
    await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Past 30 days" }));

    await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    const lastCall = mocks.fetchEventPage.mock.calls.at(-1)!;
    expect(lastCall[1].cursor).toBeNull();
  });
});

describe("editing a cell", () => {
  it("keeps an edit that a read in flight would otherwise undo", async () => {
    const slowResponses = deferred<unknown[]>();
    mocks.fetchResponsesForEvents.mockResolvedValueOnce([]);
    mocks.fetchResponsesForEvents.mockReturnValueOnce(slowResponses.promise);

    renderMatrix();
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("No response")).toBeTruthy()
    );

    // A refresh starts. The previous complete result stays on screen and stays
    // editable, so the reader can answer while it is in flight.
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await userEvent.click(within(cell(upcomingEvent.id, PLAYER)!).getByRole("button"));
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("Available")).toBeTruthy()
    );

    // The older read answers with the server's previous state.
    slowResponses.resolve([]);

    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("Available")).toBeTruthy();
  });

  it("rolls back only the cell whose write failed", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "denied" } });

    renderMatrix();
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("No response")).toBeTruthy()
    );

    await userEvent.click(within(cell(upcomingEvent.id, PLAYER)!).getByRole("button"));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("No response")).toBeTruthy();
  });
});

describe("a refresh that fails", () => {
  it("keeps the rows it already read, and stops them being edited", async () => {
    mocks.fetchResponsesForEvents.mockResolvedValueOnce([
      { event_id: upcomingEvent.id, profile_id: PLAYER, status: "available" },
    ]);
    mocks.fetchResponsesForEvents.mockRejectedValue(new Error("network"));

    renderMatrix();
    await waitFor(() =>
      expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("Available")).toBeTruthy()
    );

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText(/Couldn't refresh/)).toBeTruthy());
    // The known answer stays readable rather than vanishing…
    expect(within(cell(upcomingEvent.id, PLAYER)!).getByTitle("Available")).toBeTruthy();
    // …but it cannot be changed while it may be out of date.
    expect(within(cell(upcomingEvent.id, PLAYER)!).queryByRole("button")).toBeNull();
  });
});