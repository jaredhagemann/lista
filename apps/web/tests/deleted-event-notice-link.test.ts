/**
 * BUG-032: a deleted event's notice links to the schedule, not to the event.
 *
 * The worker linked every single-event notice to the event's page, by the job's
 * event_id, which survives the delete. A deleted event's email button and push
 * opened a page that no longer exists. Tournaments already link to the schedule
 * once deleted (docs/specs/tournaments-and-leagues.md §4); single events now do
 * too. A cancelled event still exists, and still links to its page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.TZ = "UTC";
  const tables: Record<string, unknown> = {};
  const jobs: unknown[] = [];
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const rows = () => {
      const data = tables[table] ?? null;
      return Array.isArray(data) ? data.filter((row) => filters.every((f) => f(row))) : data;
    };
    const result = () => Promise.resolve({ data: rows(), error: null });
    const written = () => Promise.resolve({ data: null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: written,
      update: () => chain,
      delete: () => chain,
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => !(column in row) || row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => !(column in row) || values.includes(row[column]));
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["neq", "gte", "lte", "order", "limit", "is"]) chain[method] = () => chain;
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: jobs.splice(0), error: null }));
  return { tables, jobs, from, rpc, sendEmail: vi.fn(async () => undefined), sendExpo: vi.fn(async () => undefined) };
});

vi.mock("@/lib/api-auth", () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/expo-push", () => ({
  sendExpoPushNotification: mocks.sendExpo,
  isDeadTokenError: () => false,
}));

import { drainNotificationJobs } from "@/lib/notifications/worker";

const APP = "https://app.example";
const PACIFIC = "America/Los_Angeles";

function queue(action: "deleted" | "cancelled") {
  mocks.jobs.push({
    id: "job-1",
    team_id: "team-1",
    event_id: "evt-1",
    action,
    kind: "event",
    occurrence_count: 1,
    attempts: 1,
    recipient_profile_ids: null,
    snapshot: {
      title: "Practice",
      event_type: "practice",
      start_time: "2026-12-12T17:00:00.000Z",
      end_time: "2026-12-12T18:30:00.000Z",
      timezone: PACIFIC,
      arrival_time: null,
      location_id: null,
      location_name: "Islay Park",
      is_cancelled: action === "cancelled",
    },
  });
}

type Sent = { subject: string; html: string; text: string };
const sent = () => (mocks.sendEmail.mock.calls[0] as unknown as [Sent])[0];
const pushed = () => (mocks.sendExpo.mock.calls[0] as unknown as [string, { url: string }])[1];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.jobs.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  mocks.tables.teams = { name: "12U Girls", timezone: PACIFIC, logo_url: null, organizations: null };
  mocks.tables.team_members = [{ team_id: "team-1", profile_id: "p1" }];
  mocks.tables.profiles = [{ id: "p1", first_name: "Ava", email: "ava@example.com", auth_user_id: "u1" }];
  mocks.tables.profile_managers = [];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [{ profile_id: "p1", expo_push_token: "ExponentPushToken[test]" }];
  mocks.tables.availability = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BUG-032: a deleted event's notice", () => {
  it("links the email to the schedule, not to the gone event", async () => {
    queue("deleted");
    await drainNotificationJobs();

    expect(sent().subject).toBe("Cancelled: Practice");
    expect(sent().html).toContain(`href="${APP}/dashboard/schedule"`);
    expect(sent().html).not.toContain("/dashboard/schedule/evt-1");
    expect(sent().text).toContain("View schedule");
  });

  it("links the push to the schedule", async () => {
    queue("deleted");
    await drainNotificationJobs();

    expect(pushed().url).toBe("/dashboard/schedule");
  });
});

describe("a cancelled event's notice, which still exists", () => {
  it("links to the event's page", async () => {
    queue("cancelled");
    await drainNotificationJobs();

    expect(sent().html).toContain(`href="${APP}/dashboard/schedule/evt-1"`);
    expect(sent().text).toContain("View event");
    expect(pushed().url).toBe("/dashboard/schedule/evt-1");
  });
});
