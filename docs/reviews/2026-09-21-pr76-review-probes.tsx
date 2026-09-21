// @vitest-environment jsdom
// Review evidence: assertions describe defects, not desired regression behavior.
// Copy temporarily to apps/web/tests/pr76-review-probes.test.tsx and run
// pnpm exec vitest run tests/pr76-review-probes.test.tsx from apps/web.
// Remove the temporary copy afterward; this is not a passing regression contract.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act, within } from "@testing-library/react";
import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
const m = vi.hoisted(() => ({ events: vi.fn(), responses: vi.fn(), roster: vi.fn(), upsert: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/events/queries", () => ({ fetchEventPage: m.events }));
vi.mock("@/lib/availability/queries", () => ({ fetchResponsesForEvents: m.responses, fetchTeamRoster: m.roster }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ upsert: m.upsert }) }) }));
vi.mock("sonner", () => ({ toast: { error: m.toast } }));
const team = "11111111-1111-1111-1111-111111111111";
const player = "22222222-2222-2222-2222-222222222222";
const event = (id: string) => ({ id, title: id, start_time: "2099-01-01T12:00:00Z", event_type: "practice" });
const response = (event_id: string, status: string) => ({ event_id, profile_id: player, status });
function pending<T>() { let resolve!: (x: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function cell(id: string) { return within(document.querySelector(`[data-cell="${id}:${player}"]`) as HTMLElement); }
function props() { return { teamId: team, currentUserId: player, isAdmin: true, timeZone: "UTC" }; }
beforeEach(() => {
  vi.resetAllMocks();
  m.events.mockResolvedValue({ items: [event("a"), event("b")], hasNext: true, nextCursor: { id: "b", startTime: "2099-01-01T12:00:00Z" } });
  m.responses.mockResolvedValue([]);
  m.roster.mockResolvedValue([{ profileId: player, name: "Player", role: "player" }]);
  m.upsert.mockResolvedValue({ error: null });
});
afterEach(cleanup);
async function ready() { const view = render(<AvailabilityMatrix {...props()} />); await waitFor(() => expect(cell("a").getByTitle("No response")).toBeTruthy()); return view; }

it("a failed write to one cell is not rolled back after another cell is edited", async () => {
  const first = pending<{ error: { message: string } }>();
  m.upsert.mockReturnValueOnce(first.promise);
  await ready();
  fireEvent.click(cell("a").getByRole("button"));
  fireEvent.click(cell("b").getByRole("button"));
  await act(async () => first.resolve({ error: { message: "denied" } }));
  expect(m.toast).toHaveBeenCalled();
  expect(cell("a").getByTitle("Available")).toBeTruthy();
});

it("two clicks on one cell can persist the older status after the newer one", async () => {
  const first = pending<{ error: null }>();
  let serverStatus = "none";
  m.upsert.mockImplementationOnce((row) => first.promise.then(result => { serverStatus = row.status; return result; }));
  m.upsert.mockImplementationOnce(async row => { serverStatus = row.status; return { error: null }; });
  await ready();
  fireEvent.click(cell("a").getByRole("button"));
  fireEvent.click(cell("a").getByRole("button"));
  await waitFor(() => expect(serverStatus).toBe("maybe"));
  await act(async () => first.resolve({ error: null }));
  expect(serverStatus).toBe("available");
  expect(cell("a").getByTitle("Maybe")).toBeTruthy();
});

it("an edit while refreshing overwrites fresh server responses in unrelated cells", async () => {
  m.responses.mockResolvedValueOnce([response("b", "available")]);
  const refresh = pending<ReturnType<typeof response>[]>();
  m.responses.mockReturnValueOnce(refresh.promise);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(m.responses).toHaveBeenCalledTimes(2));
  fireEvent.click(cell("a").getByRole("button"));
  await act(async () => refresh.resolve([response("b", "unavailable")]));
  expect(cell("a").getByTitle("Available")).toBeTruthy();
  expect(cell("b").getByTitle("Available")).toBeTruthy();
  expect(cell("b").queryByTitle("Unavailable")).toBeNull();
});

it("old-team cells remain editable while the new team is loading", async () => {
  const view = await ready();
  const newTeam = pending<unknown>();
  m.events.mockReturnValueOnce(newTeam.promise);
  view.rerender(<AvailabilityMatrix {...props()} teamId="33333333-3333-3333-3333-333333333333" />);
  await waitFor(() => expect(m.events).toHaveBeenCalledTimes(2));
  fireEvent.click(cell("a").getByRole("button"));
  expect(m.upsert).toHaveBeenCalledWith({ event_id: "a", profile_id: player, status: "available" }, { onConflict: "event_id,profile_id" });
  await act(async () => newTeam.resolve({ items: [], hasNext: false, nextCursor: null }));
});

it("a refresh started after an optimistic edit erases it while its write is pending", async () => {
  const write = pending<{ error: null }>();
  m.upsert.mockReturnValueOnce(write.promise);
  await ready();
  fireEvent.click(cell("a").getByRole("button"));
  expect(cell("a").getByTitle("Available")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(m.responses).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(cell("a").getByTitle("No response")).toBeTruthy());
  await act(async () => write.resolve({ error: null }));
  expect(cell("a").getByTitle("No response")).toBeTruthy();
});

it("the entire roster is fetched again for each event page", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "More events" }));
  await waitFor(() => expect(m.roster).toHaveBeenCalledTimes(2));
});
