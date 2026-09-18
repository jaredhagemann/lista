/**
 * The chat notification route (BUG-007, gaps 1, 3 and 5).
 *
 * It used to resolve recipients and preferences with the *sender's* client,
 * which can only see the sender's own push tokens, and it only accepted a
 * session cookie — so native senders never reached it at all. It now authorizes
 * the caller explicitly, accepts a bearer token, and hands delivery to the
 * service-role worker by enqueueing a job.
 *
 * The database and the worker are mocked; recipient expansion itself is covered
 * against a real database in tests/rls/notification-recipients.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const inserted: { table: string; values: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return Promise.resolve({ error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "eq", "in", "neq"]) chain[method] = () => chain;
    return chain;
  });

  return {
    tables,
    inserted,
    from,
    user: { id: "sender-1" } as { id: string } | null,
    drainNotificationJobs: vi.fn(async () => ({ claimed: 1, results: [] })),
    limit: vi.fn(async () => ({ success: true })),
  };
});

vi.mock("@/lib/api-auth", () => ({
  adminClient: () => ({ from: mocks.from }),
  resolveRequestUser: async () => mocks.user,
}));
vi.mock("@/lib/notifications/worker", () => ({
  drainNotificationJobs: mocks.drainNotificationJobs,
}));
vi.mock("@/lib/rate-limit", () => ({
  chatNotificationLimiter: { limit: mocks.limit },
  rateLimitResponse: () => new Response("rate limited", { status: 429 }),
}));

import { POST } from "@/app/api/chat/notify/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://lista.team/api/chat/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

function queuedJob() {
  return mocks.inserted.find((i) => i.table === "notification_jobs")?.values;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.user = { id: "sender-1" };

  mocks.tables.messages = {
    id: "msg-1",
    body: "Bring both kits tomorrow",
    sender_id: "sender-1",
    channel_id: "chan-1",
    dm_channel_id: null,
    profiles: { first_name: "Sam", last_name: "Coach" },
  };
  mocks.tables.channels = { type: "team", name: "Team Chat", team_id: "team-1" };
  mocks.tables.team_members = [
    { profile_id: "sender-1" },
    { profile_id: "player-1" },
    { profile_id: "child-1" },
  ];
});

describe("POST /api/chat/notify", () => {
  it("queues one chat job addressed to everyone but the sender", async () => {
    const response = await post({ messageId: "msg-1", channelId: "chan-1" });

    expect(response.status).toBe(200);
    const job = queuedJob();
    expect(job).toBeDefined();
    expect(job!.kind).toBe("chat");
    expect(job!.action).toBe("message");
    expect(job!.team_id).toBe("team-1");
    expect(job!.recipient_profile_ids).toEqual(["player-1", "child-1"]);
    expect(job!.batch_key).toBe("chat:msg-1");
    expect(job!.snapshot).toMatchObject({
      title: "Sam Coach in Team Chat",
      body: "Bring both kits tomorrow",
    });
    expect(mocks.drainNotificationJobs).toHaveBeenCalledTimes(1);
  });

  it("accepts a native sender, who authenticates with a bearer token", async () => {
    const response = await post(
      { messageId: "msg-1", channelId: "chan-1" },
      { Authorization: "Bearer mobile-jwt" }
    );

    expect(response.status).toBe(200);
    expect(queuedJob()).toBeDefined();
  });

  it("refuses to announce someone else's message", async () => {
    mocks.user = { id: "not-the-sender" };

    const response = await post({ messageId: "msg-1", channelId: "chan-1" });

    expect(response.status).toBe(403);
    expect(queuedJob()).toBeUndefined();
  });

  it("refuses a message that belongs to a different channel", async () => {
    const response = await post({ messageId: "msg-1", channelId: "someone-elses-channel" });

    expect(response.status).toBe(403);
    expect(queuedJob()).toBeUndefined();
  });

  it("refuses an unauthenticated caller", async () => {
    mocks.user = null;

    const response = await post({ messageId: "msg-1", channelId: "chan-1" });

    expect(response.status).toBe(401);
    expect(queuedJob()).toBeUndefined();
  });

  it("addresses a direct message to the other participant", async () => {
    mocks.tables.messages = {
      id: "msg-2",
      body: "See you there",
      sender_id: "sender-1",
      channel_id: null,
      dm_channel_id: "dm-1",
      profiles: { first_name: "Sam", last_name: "Coach" },
    };
    mocks.tables.dm_channels = { profile_a: "sender-1", profile_b: "parent-9", team_id: "team-1" };

    const response = await post({ messageId: "msg-2", dmChannelId: "dm-1" });

    expect(response.status).toBe(200);
    expect(queuedJob()!.recipient_profile_ids).toEqual(["parent-9"]);
    expect(queuedJob()!.snapshot).toMatchObject({ title: "Sam Coach" });
  });

  it("uses the chat budget, not the schedule-notification one", async () => {
    mocks.limit.mockResolvedValueOnce({ success: false });

    const response = await post({ messageId: "msg-1", channelId: "chan-1" });

    expect(response.status).toBe(429);
    expect(queuedJob()).toBeUndefined();
  });
});
