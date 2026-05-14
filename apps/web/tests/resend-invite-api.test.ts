/**
 * Unit tests for POST /api/invitations/[id]/resend.
 *
 * Focused on email_status transitions (failed→sent, failed→failed)
 * and guards against resending accepted invites.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();
  const mockAssertTeamAdmin = vi.fn();
  const mockFrom = vi.fn();
  const mockLimiterLimit = vi.fn();
  const mockSendEmail = vi.fn();
  const mockInviteBaseUrl = vi.fn().mockResolvedValue("https://lista.team");
  const mockInviteBranding = vi.fn().mockResolvedValue({ brandName: undefined, logoUrl: undefined });
  const mockUpdate = vi.fn();

  return {
    mockResolveRequestUser,
    mockAssertTeamAdmin,
    mockFrom,
    mockLimiterLimit,
    mockSendEmail,
    mockInviteBaseUrl,
    mockInviteBranding,
    mockUpdate,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
  assertTeamAdmin: mocks.mockAssertTeamAdmin,
}));

vi.mock("@/lib/rate-limit", () => ({
  invitationLimiter: { limit: mocks.mockLimiterLimit },
  rateLimitResponse: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }),
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: mocks.mockSendEmail,
  buildInviteEmailHtml: vi.fn().mockReturnValue("<html>invite</html>"),
}));

vi.mock("@/lib/invitations/invite-base-url", () => ({
  inviteBaseUrl: mocks.mockInviteBaseUrl,
  inviteBranding: mocks.mockInviteBranding,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { POST } from "@/app/api/invitations/[id]/resend/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const INVITATION_ID = "inv-abc-123";
const TEAM_ID = "team-abc";
const AUTHED_USER = { id: "user-123", email: "coach@test.com" };

function makeRequest(): Request {
  return new Request(`http://localhost:3000/api/invitations/${INVITATION_ID}/resend`, {
    method: "POST",
  });
}

function makeParams() {
  return { params: Promise.resolve({ id: INVITATION_ID }) };
}

// Builds a thenable chainable query mock resolving to { data, error: null }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(data: unknown): any {
  const p = Promise.resolve({ data, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = { then: (res: any, rej: any) => p.then(res, rej), single: () => p };
  for (const m of ["select", "eq", "is", "in", "ilike", "limit", "update"]) c[m] = () => c;
  return c;
}

const BASE_INVITATION = {
  id: INVITATION_ID,
  team_id: TEAM_ID,
  email: "jane@example.com",
  role: "player" as const,
  accepted_at: null,
  first_name: "Jane",
  last_name: "Smith",
  teams: { name: "Test Team" },
  profiles: { first_name: "Coach", last_name: "User" },
};

// Wires mockFrom so the invitation fetch returns `invitation` and update calls
// go to mockUpdate (allowing assertions on the email_status value written).
function setupFrom(invitation: unknown) {
  mocks.mockUpdate.mockReturnValue(makeChain(null));
  mocks.mockFrom.mockImplementation((table: string) => {
    if (table === "invitations") {
      return {
        select: () => makeChain(invitation),
        update: mocks.mockUpdate,
      };
    }
    return makeChain(null);
  });
}

function setupBaseAuth() {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.mockLimiterLimit.mockResolvedValue({ success: true });
  mocks.mockAssertTeamAdmin.mockResolvedValue(true);
  mocks.mockSendEmail.mockResolvedValue(undefined);
}

// ── Guards ────────────────────────────────────────────────────────────────────

describe("POST /api/invitations/[id]/resend — guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    mocks.mockLimiterLimit.mockResolvedValue({ success: true });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockLimiterLimit.mockResolvedValue({ success: false });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(429);
  });

  it("returns 404 when invitation does not exist", async () => {
    setupBaseAuth();
    setupFrom(null);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 400 and blocks resend when invitation is already accepted", async () => {
    setupBaseAuth();
    setupFrom({ ...BASE_INVITATION, accepted_at: "2024-01-15T10:00:00Z" });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already accepted/i);
    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not a team admin", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockLimiterLimit.mockResolvedValue({ success: true });
    mocks.mockAssertTeamAdmin.mockResolvedValue(false);
    setupFrom(BASE_INVITATION);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });
});

// ── email_status transitions ──────────────────────────────────────────────────

describe("POST /api/invitations/[id]/resend — email_status transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseAuth();
    setupFrom(BASE_INVITATION);
  });

  it("flips email_status to 'sent' and returns emailSent: true when send succeeds", async () => {
    mocks.mockSendEmail.mockResolvedValue(undefined);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.emailSent).toBe(true);
    expect(mocks.mockUpdate).toHaveBeenCalledWith({ email_status: "sent" });
  });

  it("keeps email_status as 'failed' and returns emailSent: false when send throws", async () => {
    mocks.mockSendEmail.mockRejectedValue(new Error("SMTP down"));

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.emailSent).toBe(false);
    expect(mocks.mockUpdate).toHaveBeenCalledWith({ email_status: "failed" });
  });

  it("always writes email_status before returning, even after a prior failure", async () => {
    // Simulates a previously-failed invite being retried: the update must always fire.
    mocks.mockSendEmail.mockRejectedValue(new Error("Timeout"));

    await POST(makeRequest(), makeParams());

    expect(mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdate).toHaveBeenCalledWith({ email_status: "failed" });
  });
});
