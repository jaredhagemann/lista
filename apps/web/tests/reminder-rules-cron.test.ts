/**
 * The daily reminders job applies the team's reminder rules, and logs every
 * reminder like a schedule notice (docs/specs/team-notification-controls.md §4.3).
 *
 * Each event the rules let through is claimed as a `notification_jobs` row of
 * kind "reminder", keyed on the event and its start time, with one delivery row
 * per recipient and channel: sent, failed, or skipped with its reason. A rerun
 * sends nothing twice, but takes back a reminder that failed, partly failed, or
 * was left sending by a run that died, and sends only what didn't go out
 * (review RR-001). The midnight sweep does the same, for those alone.
 *
 * Supabase and the senders are mocked — no network or DB required. The mock's
 * claim_reminder_job follows the SQL function's rules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Job = { id: string; event_id: string; batch_key: string; status: string; attempts: number; stale?: boolean };
type Delivery = { job_id: string; profile_id: string; channel: string; target: string | null; status: string; reason: string | null };

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const jobs = new Map<string, Job>();
  const deliveries: Delivery[] = [];
  const jobUpdates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const claims: Array<Record<string, unknown>> = [];
  let seq = 0;

  const claim = (args: { p_event_id: string; p_batch_key: string; p_retry_only?: boolean }) => {
    claims.push(args);
    const existing = jobs.get(args.p_batch_key);
    if (!existing) {
      if (args.p_retry_only) return null;
      const job = { id: `job-${++seq}`, event_id: args.p_event_id, batch_key: args.p_batch_key, status: "sending", attempts: 1 };
      jobs.set(args.p_batch_key, job);
      return { id: job.id, sent: [] };
    }
    const retryable =
      existing.attempts < 5 && (["failed", "partial"].includes(existing.status) || (existing.status === "sending" && existing.stale));
    if (!retryable) return null;
    Object.assign(existing, { status: "sending", attempts: existing.attempts + 1, stale: false });
    for (let i = deliveries.length - 1; i >= 0; i--) {
      if (deliveries[i].job_id === existing.id && deliveries[i].status !== "sent") deliveries.splice(i, 1);
    }
    const sent = deliveries
      .filter((d) => d.job_id === existing.id)
      .map(({ profile_id, channel, target }) => ({ profile_id, channel, target }));
    return { id: existing.id, sent };
  };

  const from = vi.fn((table: string) => {
    const data = () => (table === "notification_jobs" ? [...jobs.values()] : tables[table] ?? null);
    const result = () => Promise.resolve({ data: data(), error: null });
    let update: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: (values: Delivery | Delivery[]) => {
        if (table === "notification_deliveries") deliveries.push(...(Array.isArray(values) ? values : [values]));
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: Record<string, unknown>) => {
        update = values;
        return chain;
      },
      eq: (column: string, value: string) => {
        if (update && table === "notification_jobs" && column === "id") {
          jobUpdates.push({ id: value, values: update });
          const job = [...jobs.values()].find((j) => j.id === value);
          if (job) Object.assign(job, update);
        }
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "neq", "in", "gte", "lte", "lt", "or", "order"]) chain[method] = () => chain;
    return chain;
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === "claim_reminder_job"
      ? { data: claim(args as never), error: null }
      : { data: [], error: null }
  );
  return {
    tables,
    jobs,
    deliveries,
    jobUpdates,
    claims,
    reset: () => {
      jobs.clear();
      deliveries.length = 0;
      jobUpdates.length = 0;
      claims.length = 0;
      seq = 0;
    },
    from,
    rpc,
    sendEmail: vi.fn(async () => undefined),
    sendExpoPushNotification: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })) }));
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
import { GET as runSweep } from "@/app/api/cron/notifications/route";

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
const claimed = () => mocks.claims.map((c) => c.p_event_id);
const deliveryRows = () => mocks.deliveries as unknown as Array<Record<string, unknown>>;
const jobFor = (eventId: string) => mocks.jobs.get(`reminder:${eventId}:${START}`);

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.reset();
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
    expect(claimed()).toEqual(["playoff"]);
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

    expect(mocks.claims).toEqual([
      expect.objectContaining({
        p_team_id: "team-1",
        p_event_id: "practice",
        p_batch_key: `reminder:practice:${START}`,
        p_retry_only: false,
      }),
    ]);
    expect(jobFor("practice")).toMatchObject({ status: "sent" });
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
    mocks.jobs.set(`reminder:practice:${START}`, {
      id: "job-sent",
      event_id: "practice",
      batch_key: `reminder:practice:${START}`,
      status: "sent",
      attempts: 1,
    });

    const res = await run();

    expect(res.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendExpoPushNotification).not.toHaveBeenCalled();
    expect(deliveryRows()).toHaveLength(0);
  });
});

describe("a reminder that didn't go out is tried again (review RR-001)", () => {
  it("a run whose every send failed reports it, and the next run sends it", async () => {
    oneParent();
    delete mocks.tables.push_subscriptions;
    mocks.tables.events = [eventRow("practice")];
    mocks.sendEmail.mockRejectedValueOnce(new Error("provider unavailable"));

    const first = await run();

    expect(first.status).toBe(500);
    expect(await first.json()).toMatchObject({ failedEvents: [{ eventId: "practice" }] });
    expect(jobFor("practice")).toMatchObject({ status: "failed" });

    const second = await run();

    expect(second.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(jobFor("practice")).toMatchObject({ status: "sent", attempts: 2 });
    expect(deliveryRows().filter((d) => d.channel === "email").map((d) => d.status)).toEqual(["sent"]);
  });

  it("a partly sent one sends only what didn't go out", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];
    mocks.sendExpoPushNotification.mockRejectedValueOnce(new Error("push service down"));

    const first = await run();
    // Some went out: logged, not a failed run.
    expect(first.status).toBe(200);
    expect(jobFor("practice")).toMatchObject({ status: "partial" });

    await run();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendExpoPushNotification).toHaveBeenCalledTimes(2);
    expect(jobFor("practice")).toMatchObject({ status: "sent" });
    expect(deliveryRows().map((d) => `${d.channel}:${d.status}`).sort()).toEqual(["email:sent", "push:sent"]);
  });

  it("logs each delivery as it's made, so a run that dies keeps what went out", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];
    let loggedBeforePush: unknown[] = [];
    mocks.sendExpoPushNotification.mockImplementationOnce(async () => {
      loggedBeforePush = deliveryRows().map((d) => `${d.channel}:${d.status}`);
    });

    await run();

    expect(loggedBeforePush).toEqual(["email:sent"]);
  });

  it("a run that died part way is taken back once it's stale, without resending what went out", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];
    mocks.jobs.set(`reminder:practice:${START}`, {
      id: "job-dead",
      event_id: "practice",
      batch_key: `reminder:practice:${START}`,
      status: "sending",
      attempts: 1,
      stale: true,
    });
    mocks.deliveries.push({ job_id: "job-dead", profile_id: "p1", channel: "email", target: "parent@example.com", status: "sent", reason: null });

    await run();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendExpoPushNotification).toHaveBeenCalledTimes(1);
    expect(jobFor("practice")).toMatchObject({ status: "sent" });
  });

  it("an overlapping run, finding it still sending, leaves it alone", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];
    mocks.jobs.set(`reminder:practice:${START}`, {
      id: "job-live",
      event_id: "practice",
      batch_key: `reminder:practice:${START}`,
      status: "sending",
      attempts: 1,
    });

    const res = await run();

    expect(res.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendExpoPushNotification).not.toHaveBeenCalled();
  });
});

describe("the midnight sweep retries failed reminders (review RR-001)", () => {
  function sweep() {
    return runSweep(new Request("http://localhost/api/cron/notifications", { headers: { authorization: "Bearer secret" } }));
  }

  it("sends a reminder that failed, and starts none that weren't sent", async () => {
    oneParent();
    delete mocks.tables.push_subscriptions;
    mocks.tables.events = [eventRow("practice"), eventRow("other")];
    mocks.jobs.set(`reminder:practice:${START}`, {
      id: "job-failed",
      event_id: "practice",
      batch_key: `reminder:practice:${START}`,
      status: "failed",
      attempts: 1,
    });

    const res = await sweep();

    expect(res.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(sentSubjects()[0]).toContain("Event practice");
    expect(mocks.claims.every((c) => c.p_retry_only === true)).toBe(true);
    expect(jobFor("practice")).toMatchObject({ status: "sent" });
    expect(jobFor("other")).toBeUndefined();
  });

  it("with no failed reminders, reads no events", async () => {
    oneParent();
    mocks.tables.events = [eventRow("practice")];

    await sweep();

    expect(mocks.from).not.toHaveBeenCalledWith("events");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
