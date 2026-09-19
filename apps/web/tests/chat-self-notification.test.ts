/**
 * Nobody is pushed their own chat message (BUG-007 follow-up).
 *
 * The route drops the sender from the addressed members, but the worker expands
 * a managed player to their guardians — so a parent who sends a message to a
 * team their own child is on was resolved back in through the child, and got a
 * push about the message they had just typed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const jobs: unknown[] = [];

  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const written = () => Promise.resolve({ data: null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: written,
      update: () => chain,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "eq", "neq", "in"]) chain[method] = () => chain;
    return chain;
  });

  return {
    tables,
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

const SENDER = "parent-1";
const CHILD = "child-1";
const OTHER = "other-parent";

function chatJob(recipients: string[], createdBy = SENDER) {
  return {
    id: "job-1",
    team_id: "team-1",
    event_id: null,
    kind: "chat",
    action: "message",
    occurrence_count: 1,
    attempts: 1,
    created_by: createdBy,
    recipient_profile_ids: recipients,
    snapshot: { title: "Sam Coach in Team Chat", body: "Kick-off moved to 9am", url: "/dashboard/chat" },
  };
}

function pushedTokens() {
  return mocks.sendExpoPushNotification.mock.calls.map((call) => (call as unknown as [string])[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobs.length = 0;
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];

  mocks.tables.teams = { name: "U10 Girls", timezone: "America/Los_Angeles" };
  mocks.tables.profiles = [
    { id: SENDER, email: "parent@example.com", auth_user_id: "auth-1" },
    { id: CHILD, email: "managed-child@lista.internal", auth_user_id: null },
    { id: OTHER, email: "other@example.com", auth_user_id: "auth-2" },
  ];
  // The sender is one of the child's guardians.
  mocks.tables.profile_managers = [
    { managed_id: CHILD, manager_id: SENDER },
    { managed_id: CHILD, manager_id: OTHER },
  ];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [
    { profile_id: SENDER, expo_push_token: "ExponentPushToken[sender]" },
    { profile_id: OTHER, expo_push_token: "ExponentPushToken[other]" },
  ];
});

describe("chat push and the sender", () => {
  it("does not push the sender their own message, even through their child", async () => {
    mocks.jobs.push(chatJob([CHILD, OTHER]));

    await drainNotificationJobs();

    expect(pushedTokens()).toEqual(["ExponentPushToken[other]"]);
  });

  it("still reaches the child's other guardian", async () => {
    mocks.jobs.push(chatJob([CHILD]));

    await drainNotificationJobs();

    expect(pushedTokens()).toEqual(["ExponentPushToken[other]"]);
  });

  it("pushes both guardians when someone else sent the message", async () => {
    mocks.jobs.push(chatJob([CHILD], "coach-9"));

    await drainNotificationJobs();

    expect(pushedTokens().sort()).toEqual(
      ["ExponentPushToken[other]", "ExponentPushToken[sender]"].sort()
    );
  });

  it("never emails a chat message", async () => {
    mocks.jobs.push(chatJob([CHILD, OTHER]));

    await drainNotificationJobs();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
