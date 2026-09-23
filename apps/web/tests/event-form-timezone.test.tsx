// @vitest-environment jsdom
/**
 * The event form reads times in the event's timezone (BUG-010, decision D5).
 *
 * The form used to parse its date and time inputs in the browser's zone, so a
 * coach setting up a 4 PM Denver practice from anywhere else saved the wrong
 * instant, and nothing on the form said which zone the times were in.
 *
 * The process zone is pinned to Tokyo — the coach is travelling — so the unfixed
 * form stores 4 PM Tokyo time and these tests fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "Asia/Tokyo";
  // Radix's switch measures itself; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  const inserts: Array<Record<string, unknown> | Record<string, unknown>[]> = [];
  const updates: Array<Record<string, unknown>> = [];
  const from = (table: string) => {
    if (table === "locations") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    }
    return {
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        inserts.push(rows);
        const head = Array.isArray(rows) ? rows[0] : rows;
        const done = Promise.resolve({ error: null });
        return Object.assign(done, {
          select: () => ({ single: () => Promise.resolve({ data: { id: "head-1", ...head }, error: null }) }),
        });
      },
    };
  };
  return {
    inserts,
    updates,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      from,
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { EventEditForm } from "@/components/calendar/event-detail";

const DENVER = "America/Denver";

function renderForm(teamTimeZone: string | null = DENVER) {
  return render(
    <EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone={teamTimeZone} />
  );
}

async function fillAndSubmit(start: string, end: string) {
  await userEvent.type(screen.getByLabelText("Title"), "Practice");
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("End"), { target: { value: end } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
}

beforeEach(() => {
  mocks.inserts.length = 0;
  mocks.updates.length = 0;
});

afterEach(cleanup);

describe("test environment", () => {
  it("runs in Tokyo", () => {
    expect(new Date("2026-09-17T00:00:00.000Z").getTimezoneOffset()).toBe(-540);
  });
});

describe("creating an event", () => {
  it("reads the times in the team's zone and stores that zone", async () => {
    renderForm(DENVER);
    await fillAndSubmit("2026-09-17T16:00", "2026-09-17T17:30");
    submit();

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    const row = mocks.inserts[0] as Record<string, unknown>;
    // 4:00 PM Mountain Daylight Time is 22:00 UTC.
    expect(row.start_time).toBe("2026-09-17T22:00:00.000Z");
    expect(row.end_time).toBe("2026-09-17T23:30:00.000Z");
    expect(row.timezone).toBe(DENVER);
  });

  it("says which zone the times are in", () => {
    renderForm(DENVER);
    expect(screen.getByLabelText("Time zone")).toHaveProperty("value", DENVER);
  });

  it("an override reads the same inputs in the chosen zone", async () => {
    renderForm(DENVER);
    await fillAndSubmit("2026-09-17T16:00", "2026-09-17T17:30");
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/Los_Angeles" } });
    submit();

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    const row = mocks.inserts[0] as Record<string, unknown>;
    expect(row.start_time).toBe("2026-09-17T23:00:00.000Z");
    expect(row.timezone).toBe("America/Los_Angeles");
  });

  it("with no team zone, defaults to the coach's own zone and says so", async () => {
    renderForm(null);
    expect(screen.getByLabelText("Time zone")).toHaveProperty("value", "Asia/Tokyo");

    await fillAndSubmit("2026-09-17T16:00", "2026-09-17T17:30");
    submit();

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    const row = mocks.inserts[0] as Record<string, unknown>;
    expect(row.start_time).toBe("2026-09-17T07:00:00.000Z");
    expect(row.timezone).toBe("Asia/Tokyo");
  });
});

describe("creating a series", () => {
  it("keeps 4 PM in the event's zone across daylight saving, through the inclusive end date", async () => {
    renderForm(DENVER);
    await fillAndSubmit("2026-10-29T16:00", "2026-10-29T17:30");
    fireEvent.click(screen.getByRole("switch", { name: /recurring event/i }));
    fireEvent.change(await screen.findByLabelText("Repeat until"), { target: { value: "2026-11-05" } });
    submit();

    await waitFor(() => expect(mocks.inserts).toHaveLength(2));
    const head = mocks.inserts[0] as Record<string, unknown>;
    const children = mocks.inserts[1] as Record<string, unknown>[];

    expect(head.start_time).toBe("2026-10-29T22:00:00.000Z"); // MDT, UTC-6
    expect(head.timezone).toBe(DENVER);
    expect(children.map((c) => c.start_time)).toEqual(["2026-11-05T23:00:00.000Z"]); // MST, UTC-7
    expect(children.map((c) => c.end_time)).toEqual(["2026-11-06T00:30:00.000Z"]);
    expect(children.every((c) => c.timezone === DENVER)).toBe(true);
  });
});

describe("editing an event", () => {
  // 4:00–5:30 PM Mountain on Sept 17, stored as instants.
  const awayGame = {
    id: "evt-1",
    team_id: "team-1",
    title: "Away game",
    event_type: "practice",
    start_time: "2026-09-17T22:00:00+00:00",
    end_time: "2026-09-17T23:30:00+00:00",
    timezone: DENVER,
    location_id: null,
    notes: null,
    opponent: null,
    home_away: null,
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    arrival_time: null,
    recurrence_rule: null,
    parent_event_id: null,
    is_cancelled: false,
    created_by: "coach-1",
    created_at: null,
  };

  function renderEdit() {
    return render(
      <EventEditForm
        editingEvent={awayGame}
        teamId="team-1"
        timeZone={DENVER}
        teamTimeZone="America/Los_Angeles"
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
  }

  it("shows the event's local times, not the browser's", () => {
    renderEdit();
    expect(screen.getByLabelText("Start")).toHaveProperty("value", "2026-09-17T16:00");
    expect(screen.getByLabelText("End")).toHaveProperty("value", "2026-09-17T17:30");
    expect(screen.getByLabelText("Time zone")).toHaveProperty("value", DENVER);
  });

  it("saving without touching the times keeps the stored instants", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].start_time).toBe("2026-09-17T22:00:00.000Z");
    expect(mocks.updates[0].end_time).toBe("2026-09-17T23:30:00.000Z");
    expect(mocks.updates[0].timezone).toBe(DENVER);
  });

  it("choosing another zone keeps the local times, in the new zone", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/Los_Angeles" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].start_time).toBe("2026-09-17T23:00:00.000Z");
    expect(mocks.updates[0].timezone).toBe("America/Los_Angeles");
  });
});
