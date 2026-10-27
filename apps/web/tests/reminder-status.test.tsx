// @vitest-environment jsdom
/**
 * The event page's delivery line for a reminder (review RR-001).
 *
 * A failed notice is retried by the worker, so its line says "we'll retry". A
 * reminder is retried only by the midnight sweep, and only while the event
 * hasn't started, so its line promises no more than that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? (table === "notification_jobs" ? null : []), error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { EventDetail } from "@/components/calendar/event-detail";

const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };
const start = new Date(Date.now() + 6 * 60 * 60 * 1000);

const EVENT = {
  id: "evt-1",
  team_id: "team-1",
  title: "Practice",
  event_type: "practice",
  start_time: start.toISOString(),
  end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
  timezone: "UTC",
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
  tournament_id: null,
  league_id: null,
  round: null,
  placement_rank: null,
  placement_label: null,
  reminder: null,
  created_by: "coach-1",
  created_at: null,
};

function job(kind: string, status: string) {
  mocks.tables.notification_jobs = {
    id: "job-1",
    kind,
    status,
    created_at: new Date().toISOString(),
    notification_deliveries: [{ status: "failed" }],
  };
}

function renderDetail() {
  render(
    <EventDetail
      event={EVENT as never}
      isAdmin
      creatorName="Coach Casey"
      team={TEAM}
      teamTimeZone="UTC"
      currentUserId="coach-1"
      availabilityRows={[]}
      members={[]}
    />
  );
}

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
});

afterEach(cleanup);

describe("the delivery line on the event page", () => {
  it("a failed reminder promises a retry only while there's time", async () => {
    job("reminder", "failed");
    renderDetail();

    const line = await screen.findByText(/Reminder:/);
    expect(line.parentElement!.textContent).toContain("we'll try again if there's time before it starts");
    expect(line.parentElement!.textContent).not.toContain("we'll retry");
  });

  it("a failed notice still says the worker will retry it", async () => {
    job("event", "failed");
    renderDetail();

    const line = await screen.findByText(/Notifications:/);
    expect(line.parentElement!.textContent).toContain("we'll retry");
  });
});
