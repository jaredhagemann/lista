/**
 * Authentication tests for the daily notification sweep (GET /api/cron/notifications).
 *
 * The sweep sends whatever schedule-change notices are still waiting (BUG-006).
 * Vercel cron calls it with no session cookie, so the route's own CRON_SECRET
 * check is all that stands between the public internet and a fan-out of emails
 * and push notifications (BUG-008).
 *
 * Only the authentication gate is covered here; the worker is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  drainNotificationJobs: vi.fn(async () => ({ claimed: 0, results: [] })),
}));

vi.mock("@/lib/notifications/worker", () => ({
  drainNotificationJobs: mocks.drainNotificationJobs,
}));

import { GET } from "@/app/api/cron/notifications/route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function request(headers: Record<string, string> = {}) {
  return new Request("https://lista.team/api/cron/notifications", { headers });
}

describe("GET /api/cron/notifications", () => {
  it("refuses a request with no secret, and sends nothing", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.drainNotificationJobs).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await GET(request({ authorization: "Bearer not-the-secret" }));

    expect(response.status).toBe(401);
    expect(mocks.drainNotificationJobs).not.toHaveBeenCalled();
  });

  it("sweeps the queue for an authorized call", async () => {
    const response = await GET(request({ authorization: "Bearer test-secret" }));

    expect(response.status).toBe(200);
    expect(mocks.drainNotificationJobs).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ success: true, claimed: 0 });
  });

  it("reports a failed sweep rather than pretending it worked", async () => {
    mocks.drainNotificationJobs.mockRejectedValueOnce(new Error("database unreachable"));

    const response = await GET(request({ authorization: "Bearer test-secret" }));

    expect(response.status).toBe(500);
  });
});
