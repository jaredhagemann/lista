// @vitest-environment jsdom
/**
 * The schedule list's pagination (BUG-014, spec §4.3 and §6.2).
 *
 * It used to page with OFFSET and ask for an exact count on every load. The
 * offset skipped rows when an event was deleted behind it, and the count was a
 * second query whose answer was stale on arrival. Now each page continues from
 * the previous page's last row, and Next is enabled by a single lookahead row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ScheduleList } from "@/components/calendar/schedule-list";

const TEAM = "11111111-1111-1111-1111-111111111111";

function listEvent(title: string, startTime: string) {
  return {
    id: `${title}-id`,
    team_id: TEAM,
    title,
    event_type: "practice",
    start_time: startTime,
    end_time: startTime,
    is_cancelled: false,
    location_id: null,
    locations: null,
    arrival_time: null,
    notes: null,
    opponent: null,
    home_away: null,
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    recurrence_rule: null,
    parent_event_id: null,
    created_by: null,
    created_at: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const page = (title: string, hasNext: boolean) => ({
  items: [listEvent(title, "2026-12-10T18:00:00.000Z")],
  nextCursor: hasNext ? { startTime: "2026-12-10T18:00:00.000Z", id: `${title}-id` } : null,
  hasNext,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEventPage.mockResolvedValue(page("First event", false));
});

afterEach(cleanup);

function renderList() {
  return render(<ScheduleList teamId={TEAM} isAdmin team={{ name: "Test team" }} />);
}

describe("paging through the list", () => {
  it("shows the page number without claiming a total", async () => {
    renderList();

    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());
    expect(screen.getByText("Page 1")).toBeTruthy();
    // "Page 1 of 7" needed an exact count on every load, and it was stale as
    // soon as it arrived.
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
  });

  it("continues from the last row of the previous page, not an offset", async () => {
    mocks.fetchEventPage.mockResolvedValueOnce(page("First event", true));
    mocks.fetchEventPage.mockResolvedValueOnce(page("Second event", false));

    renderList();
    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(screen.getByText("Second event")).toBeTruthy());
    const [, secondArgs] = mocks.fetchEventPage.mock.calls[1];
    expect(secondArgs.cursor).toEqual({
      startTime: "2026-12-10T18:00:00.000Z",
      id: "First event-id",
    });
    expect(screen.getByText("Page 2")).toBeTruthy();
  });

  it("only offers Next when there is another page", async () => {
    renderList();

    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("goes back to the page it came from", async () => {
    mocks.fetchEventPage.mockResolvedValueOnce(page("First event", true));
    mocks.fetchEventPage.mockResolvedValueOnce(page("Second event", false));
    mocks.fetchEventPage.mockResolvedValueOnce(page("First event", true));

    renderList();
    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Second event")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));

    await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    const [, backArgs] = mocks.fetchEventPage.mock.calls[2];
    // Page 1 starts where it always did: at the beginning.
    expect(backArgs.cursor).toBeNull();
  });

  it("starts again at page 1 when the filter changes", async () => {
    mocks.fetchEventPage.mockResolvedValueOnce(page("First event", true));
    mocks.fetchEventPage.mockResolvedValueOnce(page("Second event", true));
    mocks.fetchEventPage.mockResolvedValue(page("Games only", false));

    renderList();
    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Game" }));

    await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
    const lastCall = mocks.fetchEventPage.mock.calls.at(-1)!;
    // A cursor belongs to one query; a different filter is a different result
    // set, so the old position is meaningless.
    expect(lastCall[1].cursor).toBeNull();
    expect(lastCall[1].query.eventType).toBe("game");
  });
});

describe("results that arrive too late (PR #75 review)", () => {
  it("ignores a page that belonged to the previous filter", async () => {
    const slowAll = deferred<ReturnType<typeof page>>();
    mocks.fetchEventPage.mockImplementationOnce(() => slowAll.promise);
    mocks.fetchEventPage.mockResolvedValue(page("Game event", false));

    renderList();
    // The first request is still open when the filter changes.
    await userEvent.click(screen.getByRole("button", { name: "Game" }));
    await waitFor(() => expect(screen.getByText("Game event")).toBeTruthy());

    // The original request finally answers, for a filter nobody selected.
    slowAll.resolve(page("Stale event", true));

    await waitFor(() => expect(screen.queryByText("Stale event")).toBeNull());
    expect(screen.getByText("Game event")).toBeTruthy();
    // Its cursor must not survive either: Next would continue the wrong result.
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
  });

  it("starts again when the team changes", async () => {
    mocks.fetchEventPage.mockResolvedValueOnce(page("Team A event", true));
    mocks.fetchEventPage.mockResolvedValueOnce(page("Team A page two", false));
    mocks.fetchEventPage.mockResolvedValue(page("Team B event", false));

    const { rerender } = renderList();
    await waitFor(() => expect(screen.getByText("Team A event")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());

    rerender(<ScheduleList teamId="22222222-2222-2222-2222-222222222222" isAdmin team={{ name: "Test team" }} />);

    await waitFor(() => expect(screen.getByText("Team B event")).toBeTruthy());
    // A cursor from another team's result would skip that team's earliest events.
    const lastCall = mocks.fetchEventPage.mock.calls.at(-1)!;
    expect(lastCall[1].cursor).toBeNull();
    expect(lastCall[1].query.teamId).toBe("22222222-2222-2222-2222-222222222222");
    expect(screen.getByText("Page 1")).toBeTruthy();
  });
});

describe("when the list cannot be read (PR #75 review)", () => {
  it("says so, and does not call it an empty schedule", async () => {
    mocks.fetchEventPage.mockRejectedValueOnce(new Error("network"));

    renderList();

    await waitFor(() => expect(screen.getByText(/Couldn't load/i)).toBeTruthy());
    // "No upcoming events" is an answer; a failed read is not.
    expect(screen.queryByText(/No upcoming events/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeTruthy();
  });

  it("recovers on retry", async () => {
    mocks.fetchEventPage.mockRejectedValueOnce(new Error("network"));
    mocks.fetchEventPage.mockResolvedValue(page("First event", false));

    renderList();
    await waitFor(() => expect(screen.getByText(/Couldn't load/i)).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText("First event")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load/i)).toBeNull();
  });
});
