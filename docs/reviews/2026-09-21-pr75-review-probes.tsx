// @vitest-environment jsdom
// Review probes assert observed defects, not desired regression behavior.
// To reproduce: copy temporarily to apps/web/tests/pr75-review-probes.test.tsx,
// run pnpm exec vitest run tests/pr75-review-probes.test.tsx from apps/web,
// and remove the temporary copy. Keep outside the normal regression suite.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { ScheduleList } from "@/components/calendar/schedule-list";
import { createMonthLoader } from "@/lib/events/month-cache";
const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("@/lib/events/queries", () => ({ fetchEventPage: mocks.page }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const TEAM = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
function page(title: string, hasNext = false) {
  return { items: [{ id: title, title, team_id: TEAM, event_type: "practice", start_time: "2027-01-02T12:00:00Z", end_time: "2027-01-02T13:00:00Z", locations: null }],
    hasNext, nextCursor: hasNext ? { startTime: "2027-01-02T12:00:00Z", id: title } : null };
}
beforeEach(() => { vi.clearAllMocks(); mocks.page.mockResolvedValue(page("Loaded", true)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("a slower old filter request overwrites the newer selection", async () => {
  let resolveOld!: (value: ReturnType<typeof page>) => void;
  mocks.page.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  mocks.page.mockResolvedValue(page("New filter result"));
  render(<ScheduleList teamId={TEAM} isAdmin={false} />);
  await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Game" }));
  await screen.findByText("New filter result");
  await act(async () => resolveOld(page("Old unfiltered result")));
  expect(screen.getByText("Old unfiltered result")).toBeTruthy();
  expect(screen.queryByText("New filter result")).toBeNull();
});
it("a team change reuses the prior team's page cursor", async () => {
  const view = render(<ScheduleList teamId={TEAM} isAdmin={false} />);
  await screen.findByText("Loaded");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Page 2");
  view.rerender(<ScheduleList teamId={OTHER} isAdmin={false} />);
  await waitFor(() => expect(mocks.page.mock.calls.at(-1)?.[1].query.teamId).toBe(OTHER));
  expect(mocks.page.mock.calls.at(-1)?.[1].cursor?.id).toBe("Loaded");
  await screen.findByText("Page 2");
});
it("a failed list query renders an ordinary empty schedule with no retry", async () => {
  mocks.page.mockRejectedValue(new Error("connection reset"));
  render(<ScheduleList teamId={TEAM} isAdmin={false} />);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  expect(screen.getByText(/No upcoming events/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /retry|try again/i })).toBeNull();
});
it("cached months remain unchanged indefinitely", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(["old event"]).mockResolvedValue(["updated event"]);
  const cache = createMonthLoader({ read });
  await cache.load("2027-01");
  vi.advanceTimersByTime(86400000);
  expect(await cache.load("2027-01")).toEqual(["old event"]);
  expect(read).toHaveBeenCalledTimes(1);
});
