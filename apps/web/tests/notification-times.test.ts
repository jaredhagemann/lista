/**
 * Event notification times (BUG-020).
 *
 * The first production reminder showed a 4:00–5:30 PM Pacific practice as
 * "11:00 PM – 12:30 AM": the right instant, formatted in the server's UTC zone.
 * Every event email and push notification formats times the same way, and the
 * reminder hardcoded "tomorrow" for events later the same day.
 *
 * The process timezone is pinned to UTC, like production. On a machine set to
 * Pacific time the unfixed code would print "4:00 PM" and these tests would
 * pass without a fix.
 *
 * Uses the real email builder. Supabase, rate limiting and the senders are
 * mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.TZ = "UTC";

  // Every query resolves to the data configured for its table.
  const tables: Record<string, unknown> = {};
  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["select", "eq", "neq", "in", "gte", "lte"]) chain[method] = () => chain;
    return chain;
  });

  return {
    tables,
    from,
    sendEmail: vi.fn(async () => undefined),
    sendPushNotification: vi.fn(async () => undefined),
    sendExpoPushNotification: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "coach-1" } } })) },
    from: mocks.from,
  })),
}));
vi.mock("@/lib/rate-limit", () => ({
  notificationLimiter: { limit: vi.fn(async () => ({ success: true })) },
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: mocks.sendPushNotification }));
vi.mock("@/lib/notifications/expo-push", () => ({ sendExpoPushNotification: mocks.sendExpoPushNotification }));

import { buildEventEmailHtml } from "@/lib/notifications/email";
import { GET as runReminders } from "@/app/api/cron/reminders/route";
import { POST as sendNotification } from "@/app/api/notifications/send/route";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PACIFIC = "America/Los_Angeles";

// The reported practice: 4:00–5:30 PM Pacific Daylight Time on Thursday, Sept 17.
const PRACTICE = {
  id: "evt-1",
  team_id: "team-1",
  title: "Practice",
  event_type: "practice",
  start_time: "2026-09-17T23:00:00.000Z",
  end_time: "2026-09-18T00:30:00.000Z",
  arrival_time: 30,
  locations: { name: "Islay Park" },
};

function eventFor(timezone: string | null, overrides: Partial<typeof PRACTICE> = {}) {
  return { ...PRACTICE, ...overrides, teams: { name: "AYSO Girls U10", timezone } };
}

function email(overrides: Partial<Parameters<typeof buildEventEmailHtml>[0]> = {}) {
  return buildEventEmailHtml({
    eventTitle: "Practice",
    eventType: "practice",
    startTime: PRACTICE.start_time,
    endTime: PRACTICE.end_time,
    location: "Islay Park",
    teamName: "AYSO Girls U10",
    action: "reminder",
    arrivalTime: 30,
    timeZone: PACIFIC,
    ...overrides,
  });
}

function configureTeam(events: unknown) {
  mocks.tables.events = events;
  mocks.tables.team_members = [{ profile_id: "p1", profiles: { email: "parent@example.com", auth_user_id: "u1" } }];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [{ profile_id: "p1", expo_push_token: "ExponentPushToken[test]" }];
}

function sentEmail() {
  const [args] = mocks.sendEmail.mock.calls[0] as unknown as [{ subject: string; html: string }];
  return args;
}

function sentPush() {
  const [, payload] = mocks.sendExpoPushNotification.mock.calls[0] as unknown as [string, { title: string; body: string }];
  return payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  vi.stubEnv("CRON_SECRET", "secret");
  // Only Date is faked: promises and timers keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  // The reminders cron runs at 12:00 UTC — 5:00 AM Pacific.
  vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("test environment", () => {
  it("runs with the process timezone pinned to UTC, like production", () => {
    expect(new Date(PRACTICE.start_time).getHours()).toBe(23);
  });
});

describe("event email times use the team's timezone (BUG-020)", () => {
  it("shows the reported practice as 4:00 PM – 5:30 PM PDT, not 11:00 PM", () => {
    const html = email();

    expect(html).toContain("4:00 PM – 5:30 PM PDT");
    expect(html).not.toContain("11:00 PM");
    expect(html).toContain("Thursday, September 17, 2026");
  });

  it("shows the arrival time in the team's timezone", () => {
    expect(email()).toContain("3:30 PM PDT");
  });

  it("keeps the local date for an evening event that is already the next day in UTC", () => {
    const html = email({
      startTime: "2026-09-18T01:30:00.000Z", // 6:30 PM PDT, Sept 17
      endTime: "2026-09-18T03:00:00.000Z",
    });

    expect(html).toContain("Thursday, September 17, 2026");
    expect(html).toContain("6:30 PM – 8:00 PM PDT");
  });

  it("labels winter events PST", () => {
    const html = email({
      startTime: "2026-01-15T00:00:00.000Z", // 4:00 PM PST, Jan 14
      endTime: "2026-01-15T01:30:00.000Z",
    });

    expect(html).toContain("Wednesday, January 14, 2026");
    expect(html).toContain("4:00 PM – 5:30 PM PST");
  });

  it.each([null, "Not/AZone"])("falls back to labeled UTC when the team timezone is %s", (timeZone) => {
    expect(email({ timeZone })).toContain("11:00 PM – 12:30 AM UTC");
  });
});

describe("reminders cron uses the team's timezone and the event's real day (BUG-020)", () => {
  it("calls a same-day event 'today', in local time, in the email and the push", async () => {
    configureTeam([eventFor(PACIFIC)]);

    const res = await runReminders(new Request("http://localhost/api/cron/reminders", {
      headers: { authorization: "Bearer secret" },
    }));

    expect(res.status).toBe(200);
    expect(sentEmail().subject).toBe("Reminder: Practice today");
    expect(sentEmail().html).toContain("4:00 PM – 5:30 PM PDT");
    expect(sentPush().body).toBe("Today at 4:00 PM PDT — Islay Park");
  });

  it("calls an event early the next local day 'tomorrow'", async () => {
    configureTeam([
      eventFor(PACIFIC, {
        start_time: "2026-09-18T11:00:00.000Z", // 4:00 AM PDT, Sept 18
        end_time: "2026-09-18T12:00:00.000Z",
      }),
    ]);

    await runReminders(new Request("http://localhost/api/cron/reminders", {
      headers: { authorization: "Bearer secret" },
    }));

    expect(sentEmail().subject).toBe("Reminder: Practice tomorrow");
    expect(sentPush().body).toBe("Tomorrow at 4:00 AM PDT — Islay Park");
  });

  it("labels UTC when the team has no timezone", async () => {
    configureTeam([eventFor(null)]);

    await runReminders(new Request("http://localhost/api/cron/reminders", {
      headers: { authorization: "Bearer secret" },
    }));

    expect(sentEmail().html).toContain("11:00 PM – 12:30 AM UTC");
    expect(sentPush().body).toBe("Today at 11:00 PM UTC — Islay Park");
  });
});

describe("event notifications (new / updated / cancelled) use the team's timezone (BUG-020)", () => {
  it("formats the email and push in local time", async () => {
    configureTeam(eventFor(PACIFIC));

    const res = await sendNotification(new Request("http://localhost/api/notifications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "evt-1", action: "updated" }),
    }));

    expect(res.status).toBe(200);
    expect(sentEmail().html).toContain("4:00 PM – 5:30 PM PDT");
    expect(sentEmail().html).not.toContain("11:00 PM");
    expect(sentPush().body).toBe("Thu, Sep 17 at 4:00 PM PDT — Islay Park");
  });
});
