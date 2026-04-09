/**
 * Unit tests for the shared api-auth helper and the migrated routes.
 *
 * Covers test-plan section §2:
 *   §2 — Shared helper / migrated routes still authenticate correctly
 *
 * Specifically tests resolveRequestUser() — the function all four migrated
 * routes (managed-profiles, owned-teams, account/delete, invite/accept) now
 * delegate authentication to.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockCookieGetUser = vi.fn();
  const mockBearerGetUser = vi.fn();
  // Chainable DB query builder used by adminClient().from() in DB-hitting routes.
  // Configured per-test in describe blocks that need it; the 401 tests never
  // reach DB calls so leaving this as vi.fn() with no default is safe.
  const mockEq = vi.fn();
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  return { mockCookieGetUser, mockBearerGetUser, mockFrom, mockEq, mockSelect };
});

// Mock the server Supabase client (used for cookie-session auth)
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { getUser: mocks.mockCookieGetUser } })
  ),
}));

// Mock the supabase-js client factory (used by adminClient() for Bearer auth
// and for service-role DB calls in routes that reach beyond auth).
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.mockBearerGetUser },
    from: mocks.mockFrom,
  })),
}));

// Provide env vars so adminClient() doesn't throw on missing process.env
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { resolveRequestUser } from "@/lib/api-auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/test", { headers });
}

const TEST_USER = { id: "user-abc", email: "user@test.com" };

// ── resolveRequestUser ────────────────────────────────────────────────────────

describe("resolveRequestUser (§2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // §2.1.2 — No token returns null
  it("returns null when there is no cookie session and no Authorization header", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    const result = await resolveRequestUser(makeRequest());
    expect(result).toBeNull();
  });

  // §2.1.3 — Malformed token returns null
  it("returns null when the Authorization header is present but not 'Bearer ...'", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: null } });
    const result = await resolveRequestUser(makeRequest({ Authorization: "Token abc123" }));
    expect(result).toBeNull();
    // adminClient.auth.getUser should not have been called — header wasn't Bearer
    expect(mocks.mockBearerGetUser).not.toHaveBeenCalled();
  });

  it("returns null when Bearer token is present but invalid", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: null } });
    const result = await resolveRequestUser(
      makeRequest({ Authorization: "Bearer not-a-valid-jwt" })
    );
    expect(result).toBeNull();
  });

  // §2.1.1 — Cookie session resolves user
  it("returns the user when a valid cookie session exists (web caller)", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: TEST_USER } });
    const result = await resolveRequestUser(makeRequest());
    expect(result).toEqual(TEST_USER);
    // Should short-circuit — Bearer path not reached
    expect(mocks.mockBearerGetUser).not.toHaveBeenCalled();
  });

  // §2.1.1 — Bearer token resolves user when no cookie session
  it("returns the user when a valid Bearer token is present and no cookie session", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: TEST_USER } });
    const result = await resolveRequestUser(
      makeRequest({ Authorization: "Bearer valid-jwt-token" })
    );
    expect(result).toEqual(TEST_USER);
    expect(mocks.mockBearerGetUser).toHaveBeenCalledWith("valid-jwt-token");
  });

  it("cookie auth takes priority over Bearer when both are present", async () => {
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: TEST_USER } });
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: { id: "other-user" } } });
    const result = await resolveRequestUser(
      makeRequest({ Authorization: "Bearer some-token" })
    );
    expect(result).toEqual(TEST_USER);
    expect(mocks.mockBearerGetUser).not.toHaveBeenCalled();
  });
});

// ── §2.1 — Migrated routes preserve 401 behaviour ────────────────────────────
//
// All four migrated routes (managed-profiles, owned-teams, account/delete,
// invite/accept) now delegate to resolveRequestUser. Rather than wiring up
// full mocks for each route's downstream logic, we verify the shared contract:
// when resolveRequestUser returns null the route must return 401 { error }.
// This is already covered by the §1.1 api-teams tests; the assertions below
// document the same contract for the other three visible routes.

describe("migrated routes — 401 when unauthenticated (§2.1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: null } });
  });

  it("GET /api/account/owned-teams returns 401 with no auth", async () => {
    const { GET } = await import("@/app/api/account/owned-teams/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("GET /api/account/delete returns 401 with no auth", async () => {
    const { GET } = await import("@/app/api/account/delete/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("DELETE /api/account/delete returns 401 with no auth", async () => {
    const { DELETE } = await import("@/app/api/account/delete/route");
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("POST /api/managed-profiles returns 401 with no auth", async () => {
    const { POST } = await import("@/app/api/managed-profiles/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("POST /api/invite/[id]/accept returns 401 with no auth", async () => {
    const { POST } = await import("@/app/api/invite/[id]/accept/route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "some-invite-id" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });
});

// ── §2.1.1 — Valid Bearer token still accepted ────────────────────────────────
//
// Verifies that when resolveRequestUser succeeds via the Bearer path
// (no cookie, valid token), migrated routes proceed rather than returning 401.
// Uses owned-teams as the representative route: with no owned teams the route
// returns 200 { teams: [] } without any additional DB reads, keeping the mock
// surface minimal.

describe("migrated routes — 200 when valid Bearer token (§2.1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No cookie session — forces the Bearer path in resolveRequestUser
    mocks.mockCookieGetUser.mockResolvedValue({ data: { user: null } });
    // Valid Bearer token resolves to a real user
    mocks.mockBearerGetUser.mockResolvedValue({ data: { user: TEST_USER } });
    // Stub DB: from("teams").select().eq() → no owned teams
    mocks.mockEq.mockResolvedValue({ data: [], error: null });
  });

  it("GET /api/account/owned-teams returns 200 (not 401) when Bearer token is valid", async () => {
    const { GET } = await import("@/app/api/account/owned-teams/route");
    const res = await GET(makeRequest({ Authorization: "Bearer valid-jwt-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toEqual([]);
    expect(mocks.mockBearerGetUser).toHaveBeenCalledWith("valid-jwt-token");
  });

  it("GET /api/account/delete returns 200 (not 401) when Bearer token is valid", async () => {
    const { GET } = await import("@/app/api/account/delete/route");
    // Stub: user owns no teams → eligible: true (200)
    mocks.mockEq.mockResolvedValue({ data: [], error: null });
    const res = await GET(makeRequest({ Authorization: "Bearer valid-jwt-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
    expect(mocks.mockBearerGetUser).toHaveBeenCalledWith("valid-jwt-token");
  });

  it("POST /api/managed-profiles returns 400 (not 401) when Bearer token is valid but body is empty", async () => {
    // After auth succeeds, the route validates firstName — empty body → 400.
    // No DB calls are made on this path so no additional mock setup is needed.
    const { POST } = await import("@/app/api/managed-profiles/route");
    const req = new Request("http://localhost:3000/api/managed-profiles", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt-token", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("First name is required");
    expect(mocks.mockBearerGetUser).toHaveBeenCalledWith("valid-jwt-token");
  });

  it("POST /api/invite/[id]/accept returns 404 (not 401) when Bearer token is valid but invite is missing", async () => {
    // After auth succeeds, the route fetches the invitation — mock .single() to
    // simulate a missing invite → 404.
    mocks.mockEq.mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const { POST } = await import("@/app/api/invite/[id]/accept/route");
    const req = new Request("http://localhost:3000/api/invite/missing-id/accept", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt-token", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "self" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "missing-id" }) });
    expect(res.status).toBe(404);
    expect(mocks.mockBearerGetUser).toHaveBeenCalledWith("valid-jwt-token");
  });
});
