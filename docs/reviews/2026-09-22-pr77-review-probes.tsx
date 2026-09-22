// PR #77 review at c2bd97b8a. These two tests assert desired behavior and FAIL
// on that revision. Reads/writes are mocked with controlled completion timing;
// the tests render the actual availability component.
// To run: copy to apps/web/tests/pr77-review-probes.test.tsx, then from apps/web:
// pnpm exec vitest run tests/pr77-review-probes.test.tsx
// Remove the temporary test copy afterward.
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
import { render, screen, waitFor, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  fetchEventPage: vi.fn(),
  fetchResponsesForEvents: vi.fn(),
  fetchTeamRoster: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
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
  mocks.rpc.mockResolvedValue({ data: 0, error: null });
});

afterEach(cleanup);

it("does not retain an unsaved queued choice after the preceding save fails", async () => {
  const first = deferred<{ error: { message: string } }>();
  let persisted: string | null = null;
  mocks.upsert.mockReturnValueOnce(first.promise).mockImplementation(async (row: { status: string }) => {
    persisted = row.status;
    return { error: null };
  });
  mocks.fetchResponsesForEvents.mockImplementation(async () => persisted === null ? [] : [
    { event_id: upcomingEvent.id, profile_id: PLAYER, status: persisted },
  ]);
  renderMatrix();
  const current = () => within(cell(upcomingEvent.id, PLAYER)!);
  await waitFor(() => expect(current().getByTitle("No response")).toBeTruthy());
  await userEvent.click(current().getByRole("button")); // Available in flight
  await userEvent.click(current().getByRole("button")); // Maybe queued
  expect(mocks.upsert).toHaveBeenCalledTimes(1);
  expect(current().getByTitle("Maybe")).toBeTruthy();
  await act(async () => { first.resolve({ error: { message: "network failure" } }); await first.promise; });
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalledTimes(3));
  await act(async () => {});
  // Either save the newer intent or roll it back; never show an unsaved result.
  const label = persisted === null ? "No response" : persisted[0].toUpperCase() + persisted.slice(1);
  expect(current().getByTitle(label)).toBeTruthy();
});

it("waits for uncertain bulk outcome revalidation before offering another bulk action", async () => {
  const reread = deferred<unknown[]>();
  mocks.fetchResponsesForEvents.mockResolvedValueOnce([]).mockReturnValue(reread.promise);
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
  renderMatrix();
  await waitFor(() => expect(cell(upcomingEvent.id, PLAYER)).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "Set unanswered to Available" }));
  await user.click(screen.getByRole("button", { name: "Set unanswered" }));
  await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalledTimes(2));
  expect(mocks.toastError).toHaveBeenCalled();
  const retry = screen.queryByRole("button", { name: "Set unanswered to Available" }) as HTMLButtonElement | null;
  expect(retry === null || retry.disabled).toBe(true);
  reread.resolve([]);
});

