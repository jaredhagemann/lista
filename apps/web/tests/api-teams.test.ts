/**
 * Unit tests for POST /api/teams.
 *
 * Covers test-plan sections:
 *   §1.1 — Authentication
 *   §1.2 — Request validation
 *
 * All Supabase calls are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (must run before imports) ───────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();
  const mockRpc = vi.fn();
  return { mockResolveRequestUser, mockRpc };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ rpc: mocks.mockRpc }),
}));

// Import after mocks
import { POST } from "@/app/api/teams/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const AUTHED_USER = { id: "user-123", email: "coach@test.com" };
const TEAM_ID = "team-uuid-abc";

// ── §1.1 — Authentication ─────────────────────────────────────────────────────

describe("POST /api/teams — authentication (§1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1.1.1 returns 401 { error: 'unauthorized' } when resolveRequestUser returns null", async () => {
    // Covers: no Authorization header, malformed token, expired token — all paths
    // where resolveRequestUser returns null.
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ teamName: "U12 Boys" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("1.1.4/1.1.5 authenticated request proceeds to creation logic", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.mockRpc.mockResolvedValue({ data: TEAM_ID, error: null });
    const res = await POST(makeRequest({ teamName: "U12 Boys Blue" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teamId).toBe(TEAM_ID);
  });

  it("does not call the RPC when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    await POST(makeRequest({ teamName: "U12 Boys" }));
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });
});

// ── §1.2 — Request validation ─────────────────────────────────────────────────

describe("POST /api/teams — request validation (§1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("1.2.1 returns 400 { error: 'teamName is required' } when body is empty", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("teamName is required");
  });

  it("1.2.2 returns 400 when teamName is an empty string", async () => {
    const res = await POST(makeRequest({ teamName: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("teamName is required");
  });

  it("1.2.3 returns 200 { teamId } with teamName only (no optional fields)", async () => {
    mocks.mockRpc.mockResolvedValue({ data: TEAM_ID, error: null });
    const res = await POST(makeRequest({ teamName: "U12 Boys Blue" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teamId).toBe(TEAM_ID);
  });

  it("1.2.4 returns 200 with all three fields provided", async () => {
    mocks.mockRpc.mockResolvedValue({ data: TEAM_ID, error: null });
    const res = await POST(
      makeRequest({ teamName: "U12 Boys Blue", season: "Spring 2026", orgName: "Westside FC" })
    );
    expect(res.status).toBe(200);
    expect(mocks.mockRpc).toHaveBeenCalledWith(
      "create_team",
      expect.objectContaining({
        owner_profile_id: AUTHED_USER.id,
        team_name: "U12 Boys Blue",
        season: "Spring 2026",
        org_name: "Westside FC",
      })
    );
  });

  it("1.2.5 passes empty org_name to RPC when orgName is omitted (SQL defaults to team name)", async () => {
    mocks.mockRpc.mockResolvedValue({ data: TEAM_ID, error: null });
    await POST(makeRequest({ teamName: "U12 Boys Blue" }));
    expect(mocks.mockRpc).toHaveBeenCalledWith(
      "create_team",
      expect.objectContaining({
        team_name: "U12 Boys Blue",
        org_name: "",
      })
    );
  });

  it("returns 500 when the RPC returns a database error", async () => {
    mocks.mockRpc.mockResolvedValue({ data: null, error: { message: "constraint violation" } });
    const res = await POST(makeRequest({ teamName: "U12 Boys Blue" }));
    expect(res.status).toBe(500);
  });

  it("passes owner_profile_id as the authenticated user's id", async () => {
    mocks.mockRpc.mockResolvedValue({ data: TEAM_ID, error: null });
    await POST(makeRequest({ teamName: "U12 Boys Blue" }));
    expect(mocks.mockRpc).toHaveBeenCalledWith(
      "create_team",
      expect.objectContaining({ owner_profile_id: AUTHED_USER.id })
    );
  });
});
