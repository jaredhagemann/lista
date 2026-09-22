// Follow-up review of PR #76 at c70e66071. These assert desired behavior and
// both FAIL on that revision. They exercise the real component with mocked
// repositories and controlled request ordering, not a live database.
// To run: copy into apps/web/tests/pr76-followup-review.test.tsx, then from
// apps/web run: pnpm exec vitest run tests/pr76-followup-review.test.tsx
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

it("does not let an old failure revalidation overwrite a newer saved and refreshed response", async () => {
  const failureRead = deferred<unknown[]>();
  mocks.fetchResponsesForEvents
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(failureRead.promise)
    .mockResolvedValue([{ event_id: upcomingEvent.id, profile_id: PLAYER, status: "available" }]);
  mocks.upsert
    .mockResolvedValueOnce({ error: { message: "denied" } })
    .mockResolvedValue({ error: null });

  renderMatrix();
  const current = () => within(cell(upcomingEvent.id, PLAYER)!);
  await waitFor(() => expect(current().getByTitle("No response")).toBeTruthy());
  await userEvent.click(current().getByRole("button"));
  await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current().getByTitle("No response")).toBeTruthy());

  // Retry succeeds while the failed attempt's recovery read remains in flight.
  await userEvent.click(current().getByRole("button"));
  await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.fetchResponsesForEvents).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByText(/Loading availability/)).toBeNull());
  expect(current().getByTitle("Available")).toBeTruthy();

  // The old read took its snapshot before the retry succeeded.
  const { act } = await import("@testing-library/react");
  await act(async () => { failureRead.resolve([]); await failureRead.promise; });
  expect(current().getByTitle("Available")).toBeTruthy();
});
it("keeps same-cell writes ordered when a team is left and revisited", async () => {
  const oldWrite = deferred<{ error: null }>();
  let saved: string | null = null;
  mocks.upsert
    .mockImplementationOnce((row: { status: string }) => oldWrite.promise.then(result => {
      saved = row.status;
      return result;
    }))
    .mockImplementation(async (row: { status: string }) => {
      saved = row.status;
      return { error: null };
    });
  mocks.fetchEventPage.mockImplementation(async (_client, args) =>
    eventPage(args.query.teamId === TEAM ? [upcomingEvent] : []));
  const view = renderMatrix();
  const current = () => within(cell(upcomingEvent.id, PLAYER)!);
  await waitFor(() => expect(current().getByTitle("No response")).toBeTruthy());
  await userEvent.click(current().getByRole("button"));
  expect(mocks.upsert).toHaveBeenCalledTimes(1);

  view.rerender(<AvailabilityMatrix teamId="33333333-3333-3333-3333-333333333333" currentUserId={PLAYER} isAdmin={false} timeZone="UTC" />);
  await waitFor(() => expect(screen.getByText(/No events in this range/)).toBeTruthy());
  view.rerender(<AvailabilityMatrix teamId={TEAM} currentUserId={PLAYER} isAdmin={false} timeZone="UTC" />);
  await waitFor(() => expect(current().getByTitle("No response")).toBeTruthy());
  await userEvent.click(current().getByRole("button"));
  await userEvent.click(current().getByRole("button"));
  expect(current().getByTitle("Maybe")).toBeTruthy();

  const { act } = await import("@testing-library/react");
  await act(async () => { oldWrite.resolve({ error: null }); await oldWrite.promise; });
  await waitFor(() => expect(saved).toBe("maybe"));
  expect(current().getByTitle("Maybe")).toBeTruthy();
});

