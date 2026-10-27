/**
 * The daily reminders job applies the team's reminder rules, and logs every
 * reminder like a schedule notice (docs/specs/team-notification-controls.md §4.3).
 *
 * Each event the rules let through gets a `notification_jobs` row of kind
 * "reminder", keyed on the event and its start time, and one delivery row per
 * recipient and channel: sent, failed, or skipped with its reason. A rerun the
 * same day finds the row and sends nothing twice.
 *
 * Supabase and the senders are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const inserts: Array<{ table: string; values: unknown }> = [];
  const updates: Array<{ table: string; values: unknown }> = [];
  const state = { conflictBatchKeys: new Set<string>() };
  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: (values: { batch_key?: string }) => {
        inserts.push({ table, values });
        if (table === "notification_jobs" && values.batch_key && state.conflictBatchKeys.has(values.batch_key)) {
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: unknown) => {
        updates.push({ table, values });
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "eq", "neq", "in", "gte", "lte", "order"]) chain[method] = () => chain;
    return chain;
  });
  return {
    tables,
    inserts,
    updates,
    state,
    from,
    rpc: vi.fn(async () => ({ data: [], error: null })),
    sendEmail: vi.fn(async () => undefined),
    sendExpoPushNotification: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/api-auth", () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/expo-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/expo-push")>()),
  sendExpoPushNotification: mocks.sendExpoPushNotification,
}));

import { GET as runReminders } from "@/app/api/cron/reminders/route";

const START = "2026-11-05T23:00:00.000Z";

function eventRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    team_id: "team-1",
    title: `Event ${id}`,
    event_type: "practice",
    start_time: START,
    end_time: "2026-11-06T00:30:00.000Z",
    timezone: "America/Los_Angeles",
    is_cancelled: false,
    reminder: null,
    tournament_id: null,
    arrival_time: null,
    notes: null,
    teams: { name: "U10 Girls", timezone: "America/Los_Angeles" },
    locations: null,
    tournament: null,
    ...overrides,
  };
}

function oneParent() {
  mocks.tables.team_members = [{ profile_id: "p1" }];
  mocks.tables.profiles = [{ id: "p1", email: "parent@example.com", auth_user_id: "u1" }];
  mocks.tables.push_subscriptions = [{ profile_id: "p1", expo_push_token: "ExponentPushToken[p1]" }];
}

function run() {
  return runReminders(new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer secret" } }));
}

const sentSubjects = () => (mocks.sendEmail.mock.calls as unknown as Array<[{ subject: string }]>).map(([a]) => a.subject);
const jobInserts = () =>
  mocks.inserts.filter((i) => i.table === "notification_jobs").map((i) => i.values as Record<string, unknown>);
const deliveryRows = () =>
  mocks.inserts
    .filter((i) => i.table === "notification_deliveries")
    .flatMap((i) => i.values as Array<Record<string, unknown>>);

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.inserts.length = 0;
  mocks.updates.length = 0;
  mocks.state.conflictBatchKeys.clear();
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "secret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("reminder rules in the daily job", () => {
  it("sends only the events the team's rules allow", async () => {
    oneParent();
    mocks.tables.events = [
      eventRow("practice"),
      eventRow("playoff", { event_type: "game", title: "Playoff", reminder: "always" }),
      eventRow("skipped", { reminder: "never" }),
    ];
    // Reminders are off for the team: only the game marked "Always send" goes (D9).
    mocks.tables.team_reminder_settings = [{ team_id: "team-1", enabled: false, remind_practice: true, remind_game: true, remind_other: true, remind_tournament: true }];

    const res = await run();

    expect(res.status).toBe(200);
    expect(sentSubjects()).toHaveLength(1);
    expect(sentSubjects()[0]).toContain("Playoff");
    expect(jobInserts().map((j) => j.event_id)).toEqual(["playoff"]);
  });

  it("treats a team with no settings row as all on", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];

    await run();

    expect(sentSubjects()).toHaveLength(1);
  });

  it("logs each reminder as a reminder job, keyed on the event and its start", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];

    await run();

    expect(jobInserts()).toEqual([
      expect.objectContaining({
        team_id: "team-1",
        event_id: "practice",
        kind: "reminder",
        action: "reminder",
        status: "sending",
        batch_key: `reminder:practice:${START}`,
      }),
    ]);
    const finished = mocks.updates.find((u) => u.table === "notification_jobs")?.values as Record<string, unknown>;
    expect(finished).toMatchObject({ status: "sent" });
  });

  it("records who was skipped and why: opted out, or the team muted", async () => {
    mocks.tables.events = [eventRow("practice")];
    mocks.tables.team_members = [{ profile_id: "p1" }, { profile_id: "p2" }];
    mocks.tables.profiles = [
      { id: "p1", email: "one@example.com", auth_user_id: "u1" },
      { id: "p2", email: "two@example.com", auth_user_id: "u2" },
    ];
    mocks.tables.notification_preferences = [{ profile_id: "p1", email_enabled: false, push_enabled: true }];
    mocks.tables.push_subscriptions = [{ profile_id: "p1", expo_push_token: "ExponentPushToken[p1]" }];
    mocks.tables.team_notification_mutes = [{ profile_id: "p2", email_muted: true, push_muted: true }];

    await run();

    const rows = deliveryRows().map((d) => ({ profile_id: d.profile_id, channel: d.channel, status: d.status, reason: d.reason }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { profile_id: "p1", channel: "email", status: "skipped", reason: "opted_out" },
        { profile_id: "p1", channel: "push", status: "sent", reason: null },
        { profile_id: "p2", channel: "email", status: "skipped", reason: "team_muted" },
        { profile_id: "p2", channel: "push", status: "skipped", reason: "team_muted" },
      ])
    );
    expect(rows).toHaveLength(4);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendExpoPushNotification).toHaveBeenCalledTimes(1);
  });

  it("sends nothing twice when the event was already reminded at this start time", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];
    mocks.state.conflictBatchKeys.add(`reminder:practice:${START}`);

    const res = await run();

    expect(res.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendExpoPushNotification).not.toHaveBeenCalled();
    expect(deliveryRows()).toHaveLength(0);
  });
});
