/**
 * Unit tests for POST /api/invitations/send — duplicate detection.
 *
 * All Supabase, Resend, and rate-limit calls are mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();
  const mockAssertTeamAdmin = vi.fn();
  const mockFrom = vi.fn();
  const mockSingleLimiterLimit = vi.fn();
  const mockSendEmail = vi.fn();
  const mockInviteBaseUrl = vi.fn().mockResolvedValue("https://lista.team");
  const mockInviteBranding = vi.fn().mockResolvedValue({ brandName: undefined, logoUrl: undefined });

  return {
    mockResolveRequestUser,
    mockAssertTeamAdmin,
    mockFrom,
    mockSingleLimiterLimit,
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
  invitationLimiter: { limit: mocks.mockSingleLimiterLimit },
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

import { POST } from "@/app/api/invitations/send/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown = {}): Request {
  return new Request("http://localhost:3000/api/invitations/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const AUTHED_USER = { id: "user-123", email: "coach@test.com" };
const TEAM_ID = "team-abc";

const VALID_BODY = {
  teamId: TEAM_ID,
  email: "jane@example.com",
  role: "player",
  firstName: "Jane",
  lastName: "Smith",
};

// Builds a thenable chainable query mock that resolves to { data, error: null }.
// Supports both `await chain` and `await chain.single()`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(data: unknown): any {
  const p = Promise.resolve({ data, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (res: any, rej: any) => p.then(res, rej),
    single: () => p,
    maybeSingle: () => p,
  };
  for (const m of ["select", "eq", "is", "in", "ilike", "limit", "neq"]) c[m] = () => c;
  return c;
}

/**
 * Wires up mocks.mockFrom with per-table routing.
 *
 * `profileResponses` and `teamMembersResponses` are consumed in call order:
 * each successive call to from("profiles") or from("team_members") gets the
 * next entry in the array.
 */
function setupFromRouting({
  dupInvites = [] as Array<{ birthday: string | null }>,
  profileResponses = [[] as unknown] as unknown[],
  teamMembersResponses = [[] as unknown] as unknown[],
  managerLinks = [] as Array<{ managed_id: string }>,
  insertMock = vi.fn().mockResolvedValue({ error: null }),
} = {}) {
  let profileIdx = 0;
  let tmIdx = 0;

  mocks.mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "invitations":
        return { select: () => makeChain(dupInvites), insert: insertMock };
      case "profiles": {
        const data = profileIdx < profileResponses.length ? profileResponses[profileIdx++] : null;
        return makeChain(data);
      }
      case "team_members": {
        const data = tmIdx < teamMembersResponses.length ? teamMembersResponses[tmIdx++] : [];
        return makeChain(data);
      }
      case "profile_managers":
        return makeChain(managerLinks);
      case "teams":
        return makeChain({ name: "Test Team" });
      default:
        return makeChain(null);
    }
  });

  return { insertMock };
}

function setupBaseAuth() {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.mockSingleLimiterLimit.mockResolvedValue({ success: true });
  mocks.mockAssertTeamAdmin.mockResolvedValue(true);
  mocks.mockSendEmail.mockResolvedValue(undefined);
}

// ── Duplicate detection — pending invitations ─────────────────────────────────

describe("POST /api/invitations/send — pending invitation duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseAuth();
  });

  it("returns 409 when a pending invite exists with matching email + name (no birthday)", async () => {
    setupFromRouting({
      dupInvites: [{ birthday: null }],
      profileResponses: [[]],
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already has a pending invitation/i);
  });

  it("returns 409 when pending invite birthday matches the request birthday", async () => {
    setupFromRouting({
      dupInvites: [{ birthday: "2010-05-01" }],
      profileResponses: [[]],
    });
    const res = await POST(makeRequest({ ...VALID_BODY, birthday: "2010-05-01" }));
    expect(res.status).toBe(409);
  });

  it("does not return 409 when pending invite birthday differs from request birthday", async () => {
    // Same email + name but different birthday — treat as a different person
    setupFromRouting({
      dupInvites: [{ birthday: "2011-06-15" }],
      // profileResponses for dup-check, then for inviter profile (phase 5)
      profileResponses: [[], { first_name: "Coach", last_name: "User" }],
      teamMembersResponses: [[]],
    });
    const res = await POST(makeRequest({ ...VALID_BODY, birthday: "2010-05-01" }));
    expect(res.status).toBe(200);
  });

  it("does not return 409 when no pending invite exists", async () => {
    setupFromRouting({
      dupInvites: [],
      profileResponses: [[], { first_name: "Coach", last_name: "User" }],
      teamMembersResponses: [[]],
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });
});

// ── Duplicate detection — existing team members ───────────────────────────────

describe("POST /api/invitations/send — existing team member duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseAuth();
  });

  it("returns 409 when a profile with matching email + name is already a team member", async () => {
    setupFromRouting({
      dupInvites: [],
      profileResponses: [[{ id: "p1", first_name: "Jane", last_name: "Smith", birthday: null }]],
      teamMembersResponses: [[{ id: "tm1" }]],  // direct member check returns a hit
      managerLinks: [],
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("does not return 409 when email profile exists but name differs", async () => {
    // Profile with matching email but different name — not a duplicate
    setupFromRouting({
      dupInvites: [],
      profileResponses: [
        [{ id: "p1", first_name: "Different", last_name: "Person", birthday: null }],
        { first_name: "Coach", last_name: "User" },
      ],
      teamMembersResponses: [[]],
      managerLinks: [],
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("does not return 409 when profile matches name but is not a team member", async () => {
    setupFromRouting({
      dupInvites: [],
      profileResponses: [
        [{ id: "p1", first_name: "Jane", last_name: "Smith", birthday: null }],
        { first_name: "Coach", last_name: "User" },
      ],
      teamMembersResponses: [[]],  // not a team member
      managerLinks: [],
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });
});

// ── Duplicate detection — manager email path ──────────────────────────────────

describe("POST /api/invitations/send — manager email duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseAuth();
  });

  it("returns 409 when invite email is a parent's email and player name matches a managed team member", async () => {
    // Invite is sent to parent@example.com with player name Jane Smith.
    // parent@example.com belongs to a profile whose name is "Parent Jones" (different from invite name).
    // That parent manages "player-1" who IS on the team as Jane Smith.
    setupFromRouting({
      dupInvites: [],
      profileResponses: [
        // Phase 2: email profiles — parent's profile found, but name ≠ "Jane Smith" so directMatchIds = []
        [{ id: "parent-p1", first_name: "Parent", last_name: "Jones", birthday: null }],
        // Phase 4: managed player profiles — player-1 matches "Jane Smith"
        [{ id: "player-1" }],
      ],
      teamMembersResponses: [
        // Phase 4: managed team member check — player-1 is on the team
        [{ id: "tm1" }],
      ],
      managerLinks: [{ managed_id: "player-1" }],
    });
    const res = await POST(makeRequest({ ...VALID_BODY, email: "parent@example.com" }));
    expect(res.status).toBe(409);
  });

  it("does not return 409 when manager email is found but no managed player name matches", async () => {
    // Parent manages a player named "Alex Johnson", not "Jane Smith"
    setupFromRouting({
      dupInvites: [],
      profileResponses: [
        [{ id: "parent-p1", first_name: "Parent", last_name: "Jones", birthday: null }],
        // Phase 4: no managed player matches the invite name
        [],
        { first_name: "Coach", last_name: "User" },
      ],
      teamMembersResponses: [[]],
      managerLinks: [{ managed_id: "player-1" }],
    });
    const res = await POST(makeRequest({ ...VALID_BODY, email: "parent@example.com" }));
    expect(res.status).toBe(200);
  });
});
