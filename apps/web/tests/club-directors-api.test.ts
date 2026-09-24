/**
 * The club director routes (BUG-013, part 1).
 *
 * Club settings has always called POST /api/club/directors/invite and
 * POST /api/club/directors/remove; neither existed, so both buttons 404'd. The
 * database functions decide who may do what (tests/rls/club-directors.test.ts);
 * these tests pin what the routes add around them: authentication, input
 * checks, the acting user's id, the invitation email, and how each refusal
 * reaches the client.
 *
 * Supabase, the rate limiter and the email sender are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const tables: Record<string, unknown> = {};
  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: result,
      maybeSingle: result,
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
    return chain;
  });
  return {
    tables,
    updates,
    from,
    rpc: vi.fn(),
    resolveRequestUser: vi.fn(),
    limit: vi.fn(async () => ({ success: true })),
    sendEmail: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.resolveRequestUser,
  adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/rate-limit", () => ({
  invitationLimiter: { limit: mocks.limit },
  rateLimitResponse: () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
}));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));

import { POST as invite } from "@/app/api/club/directors/invite/route";
import { POST as remove } from "@/app/api/club/directors/remove/route";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = { id: "owner-1", email: "owner@test.local" };

function post(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcError(code: string, message: string) {
  return { data: null, error: { code, message } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.resolveRequestUser.mockResolvedValue(OWNER);
  mocks.limit.mockResolvedValue({ success: true });
  mocks.tables.organizations = {
    name: "Westside FC",
    org_name_public: null,
    plan: "free",
    subdomain: null,
    custom_domain: null,
    logo_url: null,
  };
  mocks.tables.profiles = { first_name: "Olive", last_name: "Owner" };
});

// ── Invite ────────────────────────────────────────────────────────────────────

describe("POST /api/club/directors/invite", () => {
  it("requires a signed-in user", async () => {
    mocks.resolveRequestUser.mockResolvedValue(null);

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ email: "d@test.local" }],
    [{ orgId: ORG }],
    [{ orgId: ORG, email: "not-an-email" }],
  ])("rejects a missing club or a malformed address: %j", async (body) => {
    const res = await invite(post("/api/club/directors/invite", body));

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is rate limited like other invitations", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(res.status).toBe(429);
  });

  it("creates the invitation as the signed-in user and emails the recipient", async () => {
    mocks.rpc.mockResolvedValue({ data: { invitation_id: "inv-1", resent: false }, error: null });

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: " D@Test.local " }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, resent: false, emailSent: true });
    expect(mocks.rpc).toHaveBeenCalledWith("create_director_invitation", {
      p_actor_id: OWNER.id,
      p_org_id: ORG,
      p_email: "d@test.local",
    });

    const [message] = mocks.sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; html: string }];
    expect(message.to).toBe("d@test.local");
    expect(message.subject).toContain("Westside FC");
    expect(message.html).toContain("/invite/inv-1");
    expect(message.html).toContain("Olive Owner");
    expect(message.html).toContain("director");
    expect(mocks.updates).toContainEqual({ table: "invitations", values: { email_status: "sent" } });
  });

  it("asking again resends the pending invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: { invitation_id: "inv-1", resent: true }, error: null });

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(await res.json()).toMatchObject({ success: true, resent: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("records a failed email instead of failing the invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: { invitation_id: "inv-1", resent: false }, error: null });
    mocks.sendEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, emailSent: false });
    expect(mocks.updates).toContainEqual({ table: "invitations", values: { email_status: "failed" } });
  });

  it("a non-owner is refused with 403", async () => {
    mocks.rpc.mockResolvedValue(rpcError("42501", "NOT_AUTHORIZED: only the club owner can invite directors"));

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only the club owner/i);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("an existing director or the owner is refused with 409", async () => {
    mocks.rpc.mockResolvedValue(rpcError("23505", "ALREADY_MEMBER: d@test.local is already the owner or a director"));

    const res = await invite(post("/api/club/directors/invite", { orgId: ORG, email: "d@test.local" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already/i);
  });
});

// ── Remove ────────────────────────────────────────────────────────────────────

describe("POST /api/club/directors/remove", () => {
  it("requires a signed-in user", async () => {
    mocks.resolveRequestUser.mockResolvedValue(null);

    const res = await remove(post("/api/club/directors/remove", { orgId: ORG, profileId: "dir-1" }));

    expect(res.status).toBe(401);
  });

  it("rejects a request missing the club or the director", async () => {
    const res = await remove(post("/api/club/directors/remove", { orgId: ORG }));

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("removes the director as the signed-in user", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const res = await remove(post("/api/club/directors/remove", { orgId: ORG, profileId: "dir-1" }));

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("remove_org_director", {
      p_actor_id: OWNER.id,
      p_org_id: ORG,
      p_profile_id: "dir-1",
    });
  });

  it("a non-owner is refused with 403", async () => {
    mocks.rpc.mockResolvedValue(rpcError("42501", "NOT_AUTHORIZED: only the club owner can remove directors"));

    const res = await remove(post("/api/club/directors/remove", { orgId: ORG, profileId: "dir-1" }));

    expect(res.status).toBe(403);
  });

  it("someone who is not a director (including the owner) is a 404", async () => {
    mocks.rpc.mockResolvedValue(rpcError("P0002", "NOT_A_DIRECTOR"));

    const res = await remove(post("/api/club/directors/remove", { orgId: ORG, profileId: OWNER.id }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not a director/i);
  });
});
