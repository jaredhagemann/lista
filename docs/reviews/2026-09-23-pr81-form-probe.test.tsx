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

it("preserves an unchanged event in the second Denver overlap hour", async () => {
  const event = {
    id: "evt-1", team_id: "team-1", title: "Away game", event_type: "practice" as const,
    start_time: "2026-11-01T08:15:00.000Z", end_time: "2026-11-01T08:45:00.000Z", timezone: DENVER,
    location_id: null, notes: null, opponent: null, home_away: null, uniform: null,
    game_result: null, score_for: null, score_against: null, arrival_time: null,
    recurrence_rule: null, parent_event_id: null, is_cancelled: false, created_by: "coach-1", created_at: null,
  };
  render(<EventEditForm editingEvent={event} teamId="team-1" timeZone={DENVER} teamTimeZone="America/Los_Angeles" onSave={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mocks.updates).toHaveLength(1));
  expect(mocks.updates[0].start_time).toBe(event.start_time);
});

