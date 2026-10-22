/**
 * A muted team's notices skip the adult who muted it, and say so
 * (docs/specs/team-notification-controls.md §3.3).
 *
 * Event notices are resolved by team. Chat is addressed to named members, so
 * the worker passes the chat job's team for the mute to apply.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const inserted: Record<string, unknown[]> = {};
  const jobs: unknown[] = [];

  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: (rows: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])];
        return Promise.resolve({ data: null, error: null });
      },
      update: () => chain,
      delete: () => chain,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "eq", "neq", "in"]) chain[method] = () => chain;
    return chain;
  });

  return {
    tables,
    inserted,
    jobs,
    from,
    rpc: vi.fn(async () => ({ data: jobs.splice(0), error: null })),
    sendEmail: vi.fn(async () => undefined),
    sendPushNotification: vi.fn(async () => undefined),
    sendExpoPushNotification: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/api-auth", () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: mocks.sendPushNotification }));
vi.mock("@/lib/notifications/expo-push", () => ({
  sendExpoPushNotification: mocks.sendExpoPushNotification,
}));

import { drainNotificationJobs } from "@/lib/notifications/worker";

const MUTED = "muted-parent";
const LISTENING = "listening-parent";

function eventJob() {
  return {
    id: "job-event",
    team_id: "team-1",
    event_id: "event-1",
    kind: "event",
    action: "cancelled",
    occurrence_count: 1,
    attempts: 1,
    created_by: "coach-1",
    snapshot: {
      title: "Practice",
      event_type: "practice",
      start_time: "2026-10-30T23:00:00.000Z",
      end_time: "2026-10-31T00:30:00.000Z",
      arrival_time: null,
      location_id: null,
      location_name: "Islay Park",
      is_cancelled: true,
    },
  };
}

function chatJob() {
  return {
    id: "job-chat",
    team_id: "team-1",
    event_id: null,
    kind: "chat",
    action: "message",
    occurrence_count: 1,
    attempts: 1,
    created_by: "coach-1",
    recipient_profile_ids: [MUTED, LISTENING],
    snapshot: { title: "Coach in Team Chat", body: "Bring water", url: "/dashboard/chat" },
  };
}

function deliveries() {
  return (mocks.inserted.notification_deliveries ?? []) as {
    profile_id: string;
    channel: string;
    status: string;
    reason: string | null;
  }[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobs.length = 0;
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  for (const key of Object.keys(mocks.inserted)) delete mocks.inserted[key];

  mocks.tables.teams = { name: "U10 Girls", timezone: "America/Los_Angeles" };
  mocks.tables.team_members = [{ profile_id: MUTED }, { profile_id: LISTENING }];
  mocks.tables.profiles = [
    { id: MUTED, email: "muted@example.com", auth_user_id: "auth-1" },
    { id: LISTENING, email: "listening@example.com", auth_user_id: "auth-2" },
  ];
  mocks.tables.profile_managers = [];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [
    { profile_id: MUTED, expo_push_token: "ExponentPushToken[muted]" },
    { profile_id: LISTENING, expo_push_token: "ExponentPushToken[listening]" },
  ];
  mocks.tables.team_notification_mutes = [
    { profile_id: MUTED, team_id: "team-1", email_muted: true, push_muted: true },
  ];
});

describe("a muted team", () => {
  it("doesn't email or push the adult who muted it, and logs why", async () => {
    mocks.jobs.push(eventJob());

    await drainNotificationJobs();

    const emailed = mocks.sendEmail.mock.calls.map((call) => (call as unknown as [{ to: string }])[0].to);
    const pushed = mocks.sendExpoPushNotification.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(emailed).toEqual(["listening@example.com"]);
    expect(pushed).toEqual(["ExponentPushToken[listening]"]);

    const skipped = deliveries().filter((d) => d.profile_id === MUTED);
    expect(skipped.map((d) => [d.channel, d.status, d.reason])).toEqual([
      ["email", "skipped", "team_muted"],
      ["push", "skipped", "team_muted"],
    ]);
  });

  it("is offered in the footer of the team's emails", async () => {
    mocks.jobs.push(eventJob());

    await drainNotificationJobs();

    const sent = (mocks.sendEmail.mock.calls[0] as unknown as [{ html: string }])[0];
    expect(sent.html).toContain("Mute U10 Girls");
    expect(sent.html).toContain("/dashboard/settings?tab=notifications&amp;team=team-1");
  });

  it("silences the team's chat push for them too", async () => {
    mocks.jobs.push(chatJob());

    await drainNotificationJobs();

    const pushed = mocks.sendExpoPushNotification.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(pushed).toEqual(["ExponentPushToken[listening]"]);
    expect(deliveries().find((d) => d.profile_id === MUTED)?.reason).toBe("team_muted");
  });
});
