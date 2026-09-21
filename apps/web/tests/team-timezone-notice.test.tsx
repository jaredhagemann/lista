// @vitest-environment jsdom
/**
 * A team with no timezone set (BUG-014 follow-up, reported from staging).
 *
 * The grid used to group events by the browser's local date, so a team with no
 * timezone still looked right on a Pacific machine. Reading the team's zone with
 * a UTC fallback made that visible: a 4:00 PM Pacific event is 00:00 UTC the
 * next day, and landed on the wrong square.
 *
 * Falling back to the viewer's own zone restores what people saw, and the notice
 * says so rather than leaving it to be discovered. Reminder emails still resolve
 * to UTC (BUG-020's machinery), which is the real reason to set it — so the
 * notice says that too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchEventRange: vi.fn(),
  updateTeamTimeZone: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: mocks.fetchEventPage,
  fetchEventRange: mocks.fetchEventRange,
}));
vi.mock("@/lib/events/team-timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/team-timezone")>()),
  updateTeamTimeZone: mocks.updateTeamTimeZone,
}));
vi.mock("@/lib/supabase/client", () => {
  const client = {};
  return { createClient: () => client };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
}));

import { ScheduleCalendar } from "@/components/calendar/schedule-calendar";

const TEAM = "11111111-1111-1111-1111-111111111111";
const PACIFIC = "America/Los_Angeles";

/** A 4:00 PM Pacific practice — 00:00 UTC the following day. */
const eveningPractice = {
  id: "evt-1",
  team_id: TEAM,
  title: "Evening practice",
  event_type: "practice",
  start_time: "2026-12-11T00:00:00.000Z",
  end_time: "2026-12-11T01:30:00.000Z",
  is_cancelled: false,
};

function renderCalendar(props: { timeZone?: string | null; isAdmin?: boolean } = {}) {
  return render(
    <ScheduleCalendar
      teamId={TEAM}
      isAdmin={props.isAdmin ?? false}
      timeZone={props.timeZone ?? null}
      month="2026-12"
      onMonthChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEventRange.mockResolvedValue([eveningPractice]);
  mocks.updateTeamTimeZone.mockResolvedValue({ ok: true });
  // The viewer's machine is in Pacific time, as the reporter's was.
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: PACIFIC,
  } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a team with no timezone", () => {
  it("places an evening event on the day it happens, in the viewer's zone", async () => {
    renderCalendar();

    await waitFor(() => expect(screen.getByText("Evening practice")).toBeTruthy());
    // 10 December in Pacific; the UTC fallback put it on the 11th.
    const cell = screen.getByText("Evening practice").closest("[data-day]");
    expect(cell?.getAttribute("data-day")).toBe("2026-12-10");
  });

  it("says which zone it is using, and why that matters", async () => {
    renderCalendar();

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("no timezone");
    expect(notice.textContent).toContain(PACIFIC);
    // Reminders resolve to UTC until the team's zone is set (BUG-020).
    expect(notice.textContent).toMatch(/reminder/i);
  });

  it("asks a parent to tell a coach, and offers them nothing to press", async () => {
    renderCalendar({ isAdmin: false });

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/coach/i);
    expect(screen.queryByRole("button", { name: /Use America\/Los_Angeles/ })).toBeNull();
  });
});

describe("setting the team's timezone", () => {
  it("offers an admin the viewer's zone, and saves it", async () => {
    renderCalendar({ isAdmin: true });

    const button = await screen.findByRole("button", { name: `Use ${PACIFIC}` });
    await userEvent.click(button);

    await waitFor(() => expect(mocks.updateTeamTimeZone).toHaveBeenCalledTimes(1));
    const [, teamId, zone] = mocks.updateTeamTimeZone.mock.calls[0];
    expect(teamId).toBe(TEAM);
    expect(zone).toBe(PACIFIC);
    // The page re-reads the team, so the notice goes away with the new zone.
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("reports a refused write instead of pretending it worked", async () => {
    mocks.updateTeamTimeZone.mockResolvedValue({ ok: false, message: "Not allowed" });
    renderCalendar({ isAdmin: true });

    await userEvent.click(await screen.findByRole("button", { name: `Use ${PACIFIC}` }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("a team with a timezone", () => {
  it("shows no notice, and places events in the team's zone", async () => {
    renderCalendar({ timeZone: "Europe/Berlin", isAdmin: true });

    await waitFor(() => expect(screen.getByText("Evening practice")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    // 00:00 UTC is already 1:00 AM on the 11th in Berlin.
    const cell = screen.getByText("Evening practice").closest("[data-day]");
    expect(cell?.getAttribute("data-day")).toBe("2026-12-11");
  });
});
