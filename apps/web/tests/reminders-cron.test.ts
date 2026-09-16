/**
 * Authentication tests for the daily event-reminder cron (GET /api/cron/reminders).
 *
 * Why this matters: Vercel cron calls the route with no session cookie, so the
 * route's own CRON_SECRET check is the only thing standing between the public
 * internet and a fan-out of emails and push notifications to every family with
 * an event in the next 24 hours (BUG-008).
 *
 * Only the authentication gate is covered here. Supabase and all notification
 * senders are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // The events query fails, so a request that passes authentication returns 500
  // without reaching any notification sender. Anything other than 401 proves
  // the request got past the secret check.
  const eventsResult = Promise.resolve({ data: null, error: { message: "mocked" } });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lte"]) {
    chain[method] = () => chain;
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    eventsResult.then(res, rej);

  const mockFrom = vi.fn(() => chain);
  return {
    mockFrom,
    createServerClient: vi.fn(() => ({ from: mockFrom })),
    sendEmail: vi.fn(),
    sendPushNotification: vi.fn(),
    sendExpoPushNotification: vi.fn(),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/notifications/email", () => ({
  sendEmail: mocks.sendEmail,
  buildEventEmailHtml: vi.fn(() => ""),
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPushNotification: mocks.sendPushNotification,
}));
vi.mock("@/lib/notifications/expo-push", () => ({
  sendExpoPushNotification: mocks.sendExpoPushNotification,
}));

import { GET } from "@/app/api/cron/reminders/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON_SECRET = "test_cron_secret";

function makeRequest(opts: { secret?: string } = {}) {
  const headers = new Headers();
  if (opts.secret !== undefined) {
    headers.set("authorization", `Bearer ${opts.secret}`);
  }
  return new Request("http://localhost:3000/api/cron/reminders", { headers });
}

function expectNoSideEffects() {
  expect(mocks.createServerClient).not.toHaveBeenCalled();
  expect(mocks.sendEmail).not.toHaveBeenCalled();
  expect(mocks.sendPushNotification).not.toHaveBeenCalled();
  expect(mocks.sendExpoPushNotification).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("reminders cron — authentication", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
    expectNoSideEffects();
  });

  it("returns 401 on a wrong Bearer secret", async () => {
    const res = await GET(makeRequest({ secret: "wrong" }));
    expect(res.status).toBe(401);
    expectNoSideEffects();
  });

  it("returns 401 for a literal 'Bearer undefined' when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await GET(makeRequest({ secret: "undefined" }));
    expect(res.status).toBe(401);
    expectNoSideEffects();
  });

  it("gets past authentication with a valid Bearer secret", async () => {
    const res = await GET(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).not.toBe(401);
    expect(mocks.mockFrom).toHaveBeenCalledWith("events");
  });
});
