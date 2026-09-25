// @vitest-environment jsdom
/**
 * Your own answer, kept in step across the event page.
 *
 * "Your availability" and the responses list each kept their own copy of an
 * answer, so answering in "Your availability" left your read-only row in the
 * list showing the old one until the page was reloaded. The page now holds your
 * answer once and both show it: a player's row in the player groups, a coach's
 * or manager's row under Coaches & staff, and a parent's child (whoever they
 * are viewing as). A failed save puts both back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  let failNext = false;
  const outcome = () => {
    const error = failNext ? { message: "Network down" } : null;
    failNext = false;
    return Promise.resolve({ error });
  };
  const chain: Record<string, unknown> = {
    upsert: () => outcome(),
    delete: () => {
      const d: Record<string, unknown> = { eq: () => d, then: (res: (v: unknown) => unknown) => outcome().then(res) };
      return d;
    },
  };
  // The event page's other queries (notification status) resolve to nothing.
  const quiet: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "or", "in", "gte", "is"]) quiet[m] = () => quiet;
  quiet.maybeSingle = () => Promise.resolve({ data: null, error: null });
  quiet.single = quiet.maybeSingle;
  quiet.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    failOnce: () => {
      failNext = true;
    },
    client: {
      from: (table: string) => (table === "availability" ? { ...quiet, ...chain } : quiet),
      rpc: async () => ({ data: null, error: null }),
    },
    toastError: vi.fn(),
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { EventAvailability } from "@/components/availability/event-availability";
import { EventDetail } from "@/components/calendar/event-detail";

const MEMBERS = [
  { profileId: "coach-1", name: "Coach Casey", role: "coach" },
  { profileId: "p-ava", name: "Ava Smith", role: "player" },
  { profileId: "p-cy", name: "Cy", role: "player" },
];
const ROWS = [
  { profileId: "coach-1", status: "available" as const },
  { profileId: "p-ava", status: "available" as const },
];

function renderAvailability(viewer: string, isAdmin: boolean, rows = ROWS) {
  return render(
    <EventAvailability
      eventId="evt-1"
      isPast={false}
      members={MEMBERS}
      availabilityRows={rows}
      isAdmin={isAdmin}
      currentUserId={viewer}
    />
  );
}

function answer(label: string) {
  fireEvent.click(within(screen.getByRole("group", { name: "Your availability" })).getByRole("button", { name: label }));
}

function rowOf(name: string) {
  return screen.getByText(name).closest("[data-member-row]") as HTMLElement;
}

beforeEach(() => mocks.toastError.mockClear());
afterEach(cleanup);

describe("your answer in the responses list follows Your availability", () => {
  it("a player's row moves to its new group", async () => {
    renderAvailability("p-ava", false);

    answer("Unavailable");

    await waitFor(() =>
      expect(rowOf("Ava Smith").closest("[data-group]")?.getAttribute("data-group")).toBe("unavailable")
    );
    expect(within(rowOf("Ava Smith")).getByLabelText("Unavailable")).toBeTruthy();
    expect(screen.getByText("1 unavailable")).toBeTruthy();
  });

  it("a coach's row under Coaches & staff shows the new answer", async () => {
    renderAvailability("coach-1", true);

    answer("Maybe");

    await waitFor(() => expect(within(rowOf("Coach Casey")).getByLabelText("Maybe")).toBeTruthy());
  });

  it("clearing your answer shows no response", async () => {
    renderAvailability("coach-1", true);

    answer("Available");

    await waitFor(() => expect(within(rowOf("Coach Casey")).getByLabelText("No response")).toBeTruthy());
  });

  it("a parent viewing as their child updates the child's row", async () => {
    renderAvailability("p-cy", false);

    answer("Available");

    await waitFor(() =>
      expect(rowOf("Cy").closest("[data-group]")?.getAttribute("data-group")).toBe("available")
    );
  });

  it("a failed save puts the row back too", async () => {
    renderAvailability("p-ava", false);
    mocks.failOnce();

    answer("Unavailable");

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Network down"));
    expect(within(rowOf("Ava Smith")).getByLabelText("Available")).toBeTruthy();
  });

  it("does not touch anyone else's row", async () => {
    renderAvailability("p-ava", false);

    answer("Unavailable");

    await waitFor(() => expect(within(rowOf("Ava Smith")).getByLabelText("Unavailable")).toBeTruthy());
    expect(within(rowOf("Coach Casey")).getByLabelText("Available")).toBeTruthy();
  });
});

describe("on the event page", () => {
  it("answering in Your availability updates your row in the list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    render(
      <EventDetail
        event={{
          id: "evt-1",
          team_id: "team-1",
          title: "Practice",
          event_type: "practice",
          start_time: "2026-12-12T17:00:00+00:00",
          end_time: "2026-12-12T18:30:00+00:00",
          timezone: "America/Los_Angeles",
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
          created_by: "coach-1",
          created_at: null,
        }}
        isAdmin={false}
        creatorName="Coach Casey"
        team={{ name: "U10 Girls" }}
        currentUserId="p-ava"
        availabilityRows={ROWS}
        members={MEMBERS}
      />
    );

    answer("Maybe");

    await waitFor(() => expect(within(rowOf("Ava Smith")).getByLabelText("Maybe")).toBeTruthy());
    vi.useRealTimers();
  });
});
