/**
 * Unit tests for POST /api/invitations/bulk-send.
 *
 * All Supabase, Resend, and rate-limit calls are mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();
  const mockAssertTeamAdmin = vi.fn();

  // Chainable Supabase query builder
  const mockSingle = vi.fn();
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockInsert = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert });

  const mockBulkLimiterLimit = vi.fn();
  const mockSendEmail = vi.fn();

  // inviteBaseUrl and inviteBranding return simple values
  const mockInviteBaseUrl = vi.fn().mockResolvedValue("https://lista.team");
  const mockInviteBranding = vi.fn().mockResolvedValue({ brandName: undefined, logoUrl: undefined });

  return {
    mockResolveRequestUser,
    mockAssertTeamAdmin,
    mockFrom,
    mockSelect,
    mockEq,
    mockSingle,
    mockInsert,
    mockBulkLimiterLimit,
    mockSendEmail,
    mockInviteBaseUrl,
    mockInviteBranding,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
  assertTeamAdmin: mocks.mockAssertTeamAdmin,
}));

vi.mock("@/lib/rate-limit", () => ({
  bulkInvitationLimiter: { limit: mocks.mockBulkLimiterLimit },
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

import { POST } from "@/app/api/invitations/bulk-send/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown = {}): Request {
  return new Request("http://localhost:3000/api/invitations/bulk-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const AUTHED_USER = { id: "user-123", email: "coach@test.com" };
const TEAM_ID = "team-abc";

const VALID_ROW = {
  first_name: "Jane",
  last_name: "Smith",
  email: "jane@example.com",
  role: "player",
};

// Builds a thenable chainable query mock that resolves to { data, error: null }.
// Supports both `await chain` and `await chain.single()`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(data: unknown): any {
  const p = Promise.resolve({ data, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = { then: (res: any, rej: any) => p.then(res, rej), single: () => p };
  for (const m of ["select", "eq", "is", "in", "ilike", "limit"]) c[m] = () => c;
  return c;
}

// Routes from(table) calls by table name so the route's Promise.all queries all resolve.
// pendingInvites and teamMembers default to [] (no duplicates) so the happy path proceeds.
function setupDefaultMocks({
  pendingInvites = [] as unknown[],
  teamMembers = [] as unknown[],
  managerLinks = [] as unknown[],
} = {}) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.mockBulkLimiterLimit.mockResolvedValue({ success: true });
  mocks.mockAssertTeamAdmin.mockResolvedValue(true);
  mocks.mockSendEmail.mockResolvedValue(undefined);
  mocks.mockInsert.mockResolvedValue({ error: null });

  mocks.mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "profiles":         return makeChain({ first_name: "Coach", last_name: "User" });
      case "teams":            return makeChain({ name: "Test Team" });
      case "team_members":     return makeChain(teamMembers);
      case "profile_managers": return makeChain(managerLinks);
      case "invitations": {
        const sel = makeChain(pendingInvites);
        return { select: () => sel, insert: mocks.mockInsert };
      }
      default: return makeChain(null);
    }
  });
}

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockBulkLimiterLimit.mockResolvedValue({ success: false });
  });

  it("returns 429 when rate limit exceeded", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(res.status).toBe(429);
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockBulkLimiterLimit.mockResolvedValue({ success: true });
    mocks.mockAssertTeamAdmin.mockResolvedValue(false);
  });

  it("returns 403 when caller is not a team admin", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Not authorized");
  });
});

// ── Request validation ────────────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockBulkLimiterLimit.mockResolvedValue({ success: true });
    mocks.mockAssertTeamAdmin.mockResolvedValue(true);
  });

  it("returns 400 when teamId is missing", async () => {
    const res = await POST(makeRequest({ rows: [VALID_ROW] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when rows is not an array", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: "not-an-array" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when rows exceed 100", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      ...VALID_ROW,
      email: `user${i}@example.com`,
    }));
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/100/);
  });
});

// ── Send-before-insert ordering and email_status ──────────────────────────────

describe("POST /api/invitations/bulk-send — send-before-insert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("returns 200 with sent count when email succeeds", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("inserts with email_status='sent' when Resend succeeds", async () => {
    mocks.mockSendEmail.mockResolvedValue(undefined);
    await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(mocks.mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_status: "sent" })
    );
  });

  it("inserts with email_status='failed' when Resend throws", async () => {
    mocks.mockSendEmail.mockRejectedValue(new Error("Resend down"));
    await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(mocks.mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_status: "failed" })
    );
  });

  it("sendEmail is called before insert", async () => {
    const callOrder: string[] = [];
    mocks.mockSendEmail.mockImplementation(async () => {
      callOrder.push("send");
    });
    mocks.mockInsert.mockImplementation(async () => {
      callOrder.push("insert");
      return { error: null };
    });

    await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(callOrder).toEqual(["send", "insert"]);
  });

  it("still inserts invitation when Resend fails", async () => {
    mocks.mockSendEmail.mockRejectedValue(new Error("Resend down"));
    await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }))).json();
    expect(body.failed).toBe(1);
  });
});

// ── Server-side re-validation ─────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — server-side validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("skips rows with errors, does not block valid rows", async () => {
    const rows = [
      VALID_ROW,
      { first_name: "", last_name: "X", email: "bad@example.com", role: "player" }, // error
    ];
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows }));
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate rows (warnings), sends valid first occurrence", async () => {
    const rows = [VALID_ROW, VALID_ROW]; // exact duplicate
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows }));
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it("does not flag same email + different role as duplicate", async () => {
    const rows = [
      { ...VALID_ROW, role: "player" },
      { ...VALID_ROW, role: "coach" },
    ];
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows }));
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(mocks.mockInsert).toHaveBeenCalledTimes(2);
  });
});

// ── DB-backed duplicate detection ─────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — duplicate detection (DB)", () => {
  type PendingInvite = { email: string; first_name: string; last_name: string; birthday: string | null };
  type TeamMember = { profile_id: string; profiles: { email: string; first_name: string; last_name: string; birthday: string | null } };
  type ManagerLink = { managed_id: string; profiles: { email: string | null } | null };

  function setup(opts: {
    pendingInvites?: PendingInvite[];
    teamMembers?: TeamMember[];
    managerLinks?: ManagerLink[];
  } = {}) {
    setupDefaultMocks(opts);
  }

  beforeEach(() => vi.clearAllMocks());

  it("skips a row matching a pending invitation and reports it in already_exists_rows", async () => {
    setup({ pendingInvites: [{ email: "jane@example.com", first_name: "Jane", last_name: "Smith", birthday: null }] });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }))).json();
    expect(body.sent).toBe(0);
    expect(body.already_exists).toBe(1);
    expect(body.already_exists_rows).toEqual([{ email: "jane@example.com", first_name: "Jane", last_name: "Smith" }]);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("skips a row matching an existing team member (profile email + name)", async () => {
    setup({
      teamMembers: [{
        profile_id: "p1",
        profiles: { email: "jane@example.com", first_name: "Jane", last_name: "Smith", birthday: null },
      }],
    });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }))).json();
    expect(body.sent).toBe(0);
    expect(body.already_exists).toBe(1);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("skips a row via manager email: invite email = parent email, player name matches", async () => {
    const PARENT_ROW = { ...VALID_ROW, email: "parent@example.com" };
    setup({
      teamMembers: [{
        profile_id: "player-1",
        profiles: { email: "player@example.com", first_name: "Jane", last_name: "Smith", birthday: null },
      }],
      managerLinks: [{ managed_id: "player-1", profiles: { email: "parent@example.com" } }],
    });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [PARENT_ROW] }))).json();
    expect(body.sent).toBe(0);
    expect(body.already_exists).toBe(1);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("does not skip when email matches a pending invite but name differs", async () => {
    setup({ pendingInvites: [{ email: "jane@example.com", first_name: "Different", last_name: "Person", birthday: null }] });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }))).json();
    expect(body.sent).toBe(1);
    expect(body.already_exists).toBe(0);
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it("skips when invite birthday matches the pending invite birthday", async () => {
    const rowWithBirthday = { ...VALID_ROW, birthday: "2010-05-01" };
    setup({ pendingInvites: [{ email: "jane@example.com", first_name: "Jane", last_name: "Smith", birthday: "2010-05-01" }] });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [rowWithBirthday] }))).json();
    expect(body.sent).toBe(0);
    expect(body.already_exists).toBe(1);
  });

  it("does not skip when birthdays differ (same email + name)", async () => {
    const rowWithBirthday = { ...VALID_ROW, birthday: "2010-05-01" };
    setup({ pendingInvites: [{ email: "jane@example.com", first_name: "Jane", last_name: "Smith", birthday: "2011-06-15" }] });
    const body = await (await POST(makeRequest({ teamId: TEAM_ID, rows: [rowWithBirthday] }))).json();
    expect(body.sent).toBe(1);
    expect(body.already_exists).toBe(0);
  });
});

// ── Batch result shape ────────────────────────────────────────────────────────

describe("POST /api/invitations/bulk-send — result shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("returns success: true with sent/skipped/failed counts", async () => {
    const res = await POST(makeRequest({ teamId: TEAM_ID, rows: [VALID_ROW] }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.sent).toBe("number");
    expect(typeof body.skipped).toBe("number");
    expect(typeof body.failed).toBe("number");
    expect(Array.isArray(body.results)).toBe(true);
  });
});
