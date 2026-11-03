/**
 * Invite signups have their own rate limit (BUG-044). Families signing up together
 * on one network share an IP, and 5 per 10 minutes stopped them partway through.
 *
 * Whether an invitation is required is covered against the real database in
 * tests/rls/invite-signup-route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructed: [] as { prefix: string; window: unknown }[],
  signupLimit: vi.fn(),
  inviteSignupLimit: vi.fn(),
  createUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

describe("the limits themselves", () => {
  it("gives invite signups 30 per 10 minutes, counted apart from regular signups' 5", async () => {
    vi.resetModules();
    vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
    vi.doMock("@upstash/ratelimit", () => {
      class Ratelimit {
        static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
        constructor(config: { prefix: string; limiter: unknown }) {
          mocks.constructed.push({ prefix: config.prefix, window: config.limiter });
        }
      }
      return { Ratelimit };
    });

    await vi.importActual("@/lib/rate-limit");

    const windowFor = (prefix: string) => mocks.constructed.find((l) => l.prefix === prefix)?.window;
    expect(windowFor("rl:invite-signup")).toEqual({ tokens: 30, window: "10 m" });
    expect(windowFor("rl:signup")).toEqual({ tokens: 5, window: "10 m" });
  });
});

describe("POST /api/auth/invite-signup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/lib/rate-limit", () => ({
      signupLimiter: { limit: mocks.signupLimit },
      inviteSignupLimiter: { limit: mocks.inviteSignupLimit },
      rateLimitResponse: () => new Response("{}", { status: 429 }),
    }));
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        auth: { admin: { createUser: mocks.createUser } },
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
        }),
      }),
    }));
    mocks.signupLimit.mockResolvedValue({ success: false });
    mocks.inviteSignupLimit.mockResolvedValue({ success: true });
    mocks.createUser.mockResolvedValue({ error: null });
    mocks.maybeSingle.mockResolvedValue({
      data: { email: "parent@example.com", accepted_at: null },
      error: null,
    });
  });

  const post = async () => {
    const { POST } = await import("@/app/api/auth/invite-signup/route");
    return POST(
      new Request("http://localhost/api/auth/invite-signup", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        body: JSON.stringify({ inviteId: "invite-1", password: "secret123" }),
      }),
    );
  };

  it("isn't stopped by the regular signup limit being used up", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(mocks.signupLimit).not.toHaveBeenCalled();
  });

  it("counts by IP, using the first forwarded address", async () => {
    await post();

    expect(mocks.inviteSignupLimit).toHaveBeenCalledWith("203.0.113.9");
  });

  it("stops at its own limit, before looking anything up", async () => {
    mocks.inviteSignupLimit.mockResolvedValue({ success: false });

    const res = await post();

    expect(res.status).toBe(429);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
