// @vitest-environment jsdom
/**
 * What the schedule tabs actually fetch (BUG-014, spec §6 and §12).
 *
 * Opening the page used to read the team's entire event history before either
 * tab rendered, and the calendar then filtered it in memory. The rules being
 * pinned here:
 *
 *   - the default List tab reads one page and nothing else — no history, no month
 *   - the calendar reads only once it is opened, and remembers months it has seen
 *   - a month that arrives late never lands under a different month's label
 *   - a month that fails says so, keeps its navigation, and can be retried
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchEventRange: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
  fetchEventRange: mocks.fetchEventRange,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ScheduleView } from "@/components/calendar/schedule-view";

const TEAM = "11111111-1111-1111-1111-111111111111";
const PACIFIC = "America/Los_Angeles";

function calendarEvent(title: string, startTime: string) {
  return {
    id: `${title}-id`,
    team_id: TEAM,
    title,
    event_type: "practice",
    start_time: startTime,
    end_time: startTime,
    is_cancelled: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderSchedule() {
  return render(<ScheduleView teamId={TEAM} isAdmin timeZone={PACIFIC} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-12-15T12:00:00.000Z"));
  mocks.fetchEventPage.mockResolvedValue({ items: [], nextCursor: null, hasNext: false });
  mocks.fetchEventRange.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("opening the schedule", () => {
  it("reads one list page, and no events for the calendar", async () => {
    renderSchedule();

    await waitFor(() => expect(mocks.fetchEventPage).toHaveBeenCalledTimes(1));
    // The calendar is not mounted, so no month is fetched and no history is read.
    expect(mocks.fetchEventRange).not.toHaveBeenCalled();

    const [, args] = mocks.fetchEventPage.mock.calls[0];
    expect(args.projection).toBe("list");
    expect(args.cursor).toBeNull();
    expect(args.query.teamId).toBe(TEAM);
  });

  it("reads the current month only once the calendar is opened", async () => {
    renderSchedule();
    await waitFor(() => expect(mocks.fetchEventPage).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));

    await waitFor(() => expect(mocks.fetchEventRange).toHaveBeenCalled());

    // The month on screen is read first. December 2026 in Pacific time, as
    // half-open UTC instants.
    const [, args] = mocks.fetchEventRange.mock.calls[0];
    expect(args.query.fromInclusive).toBe("2026-12-01T08:00:00.000Z");
    expect(args.query.toExclusive).toBe("2027-01-01T08:00:00.000Z");
    expect(args.query.includeCancelled).toBe(false);

    // Then its neighbours, quietly, so paging through months is instant. Three
    // months, and nothing beyond them: prefetching does not cascade.
    await waitFor(() => expect(mocks.fetchEventRange).toHaveBeenCalledTimes(3));
    const requested = mocks.fetchEventRange.mock.calls
      .map(([, call]) => call.query.fromInclusive.slice(0, 7))
      .sort();
    expect(requested).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("moving between months", () => {
  it("does not put a late month under the month now on screen", async () => {
    const december = deferred<ReturnType<typeof calendarEvent>[]>();
    mocks.fetchEventRange.mockImplementation((_client: unknown, args: { query: { fromInclusive: string } }) => {
      if (args.query.fromInclusive.startsWith("2026-12")) return december.promise;
      if (args.query.fromInclusive.startsWith("2027-01")) {
        return Promise.resolve([calendarEvent("January practice", "2027-01-05T18:00:00.000Z")]);
      }
      return Promise.resolve([]);
    });

    renderSchedule();
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    // Straight on to January while December is still in flight.
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));

    await waitFor(() => expect(screen.getByText("January 2027")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("January practice")).toBeTruthy());

    // December finally answers, for a month nobody is looking at.
    december.resolve([calendarEvent("December practice", "2026-12-10T18:00:00.000Z")]);

    await waitFor(() => expect(screen.queryByText("December practice")).toBeNull());
    expect(screen.getByText("January practice")).toBeTruthy();
  });

  it("returns to a month it has already read without asking again", async () => {
    mocks.fetchEventRange.mockResolvedValue([
      calendarEvent("December practice", "2026-12-10T18:00:00.000Z"),
    ]);

    renderSchedule();
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await waitFor(() => expect(screen.getByText("December practice")).toBeTruthy());

    const readsAfterFirstMonth = mocks.fetchEventRange.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByText("January 2027")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByText("December 2026")).toBeTruthy());

    // December came from memory; only January's own read was added.
    expect(mocks.fetchEventRange.mock.calls.length).toBeLessThanOrEqual(
      readsAfterFirstMonth + 1
    );
    expect(screen.getByText("December practice")).toBeTruthy();
  });

  it("keeps the calendar's month when the user visits the list and comes back", async () => {
    renderSchedule();
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByText("January 2027")).toBeTruthy());

    await userEvent.click(screen.getByRole("tab", { name: "List" }));
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));

    // Not back to today: the selection belongs to the page, not the component.
    expect(screen.getByText("January 2027")).toBeTruthy();
  });
});

describe("when a month cannot be read", () => {
  it("says so, keeps navigation, and retries on request", async () => {
    mocks.fetchEventRange.mockRejectedValueOnce(new Error("network"));
    mocks.fetchEventRange.mockResolvedValue([
      calendarEvent("December practice", "2026-12-10T18:00:00.000Z"),
    ]);

    renderSchedule();
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));

    await waitFor(() => expect(screen.getByText(/Couldn't load December 2026/)).toBeTruthy());
    // The whole page is not replaced by the error: the month can still be changed.
    expect(screen.getByRole("button", { name: "Next month" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("December practice")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
});
