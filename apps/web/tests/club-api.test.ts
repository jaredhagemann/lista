/**
 * Unit tests for the Club Admin Portal API routes.
 *
 * Covers:
 *   POST /api/club/teams   — create a team within an existing club org
 *   PATCH /api/club/settings — update org branding / name settings
 *
 * All Supabase calls are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();
  const mockAssertTeamAdmin = vi.fn();

  // Per-table results; tests set these before each case.
  // Each entry is what .single()/.maybeSingle()/plain-await returns for that table.
  const tableData: Record<string, unknown> = {};
  // Per-table insert errors (null = success)
  const insertErrors: Record<string, object | null> = {};
  // Per-table update errors (null = success)
  const updateErrors: Record<string, object | null> = {};

  // Thenable chain — supports both .maybeSingle()/.single() and plain await
  const makeChain = (val: unknown): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const chain: Record<string, unknown> = {
      eq: () => makeChain(val),
      in: () => makeChain(val),
      neq: () => makeChain(val),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const result = tableData[table] ?? null;
    return {
      select: () => makeChain(result),
      insert: (_rows: unknown) =>
        Promise.resolve({ data: null, error: insertErrors[table] ?? null }),
      update: (_vals: unknown) => ({
        eq: () =>
          Promise.resolve({ data: null, error: updateErrors[table] ?? null }),
      }),
      delete: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    };
  });

  return {
    mockResolveRequestUser,
    mockAssertTeamAdmin,
    mockFrom,
    tableData,
    insertErrors,
    updateErrors,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
  assertTeamAdmin: mocks.mockAssertTeamAdmin,
}));

// Silence Redis / tenant cache calls inside club/settings
vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: vi.fn().mockResolvedValue(undefined),
}));

// ── Route imports (after mocks) ───────────────────────────────────────────────

import { POST } from "@/app/api/club/teams/route";
import { PATCH } from "@/app/api/club/settings/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };
const ORG_MEMBERS = [
  { profile_id: "profile-uuid", role: "owner" },
  { profile_id: "other-profile-uuid", role: "director" },
];

function makeTeamsRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/club/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSettingsRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/club/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── POST /api/club/teams ──────────────────────────────────────────────────────

describe("POST /api/club/teams — authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    Object.keys(mocks.insertErrors).forEach((k) => delete mocks.insertErrors[k]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(makeTeamsRequest({ orgId: "org-1", teamName: "U12" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });
});

describe("POST /api/club/teams — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 400 when orgId is missing", async () => {
    const res = await POST(makeTeamsRequest({ teamName: "U12" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("orgId is required");
  });

  it("returns 400 when teamName is missing", async () => {
    const res = await POST(makeTeamsRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("teamName is required");
  });

  it("returns 400 when teamName is blank whitespace", async () => {
    const res = await POST(makeTeamsRequest({ orgId: "org-1", teamName: "   " }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("teamName is required");
  });
});

describe("POST /api/club/teams — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await POST(makeTeamsRequest({ orgId: "org-1", teamName: "U12" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("profile_not_found");
  });

  it("returns 403 when caller is not a member of the org", async () => {
    mocks.tableData.profiles = PROFILE;
    // org members list does not include the caller's profile_id
    mocks.tableData.organization_members = [];
    const res = await POST(makeTeamsRequest({ orgId: "org-1", teamName: "U12" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });
});

describe("POST /api/club/teams — success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    Object.keys(mocks.insertErrors).forEach((k) => delete mocks.insertErrors[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = ORG_MEMBERS;
  });

  it("returns 201 { ok: true } when team is created successfully", async () => {
    const res = await POST(
      makeTeamsRequest({ orgId: "org-1", teamName: "U12 Boys Blue" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 201 even when member enrollment insert fails (non-fatal)", async () => {
    mocks.insertErrors.teams = null; // team insert succeeds
    mocks.insertErrors.team_members = { message: "duplicate key" }; // members fail
    const res = await POST(
      makeTeamsRequest({ orgId: "org-1", teamName: "U12 Boys Blue" })
    );
    expect(res.status).toBe(201);
  });

  it("returns 500 when the team insert itself fails", async () => {
    mocks.insertErrors.teams = { message: "constraint violation" };
    const res = await POST(
      makeTeamsRequest({ orgId: "org-1", teamName: "U12 Boys Blue" })
    );
    expect(res.status).toBe(500);
  });
});

// ── PATCH /api/club/settings ──────────────────────────────────────────────────

describe("PATCH /api/club/settings — authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await PATCH(makeSettingsRequest({ orgId: "org-1", orgName: "FC" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });
});

describe("PATCH /api/club/settings — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 400 when orgId is missing", async () => {
    const res = await PATCH(makeSettingsRequest({ orgName: "FC" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("orgId is required");
  });

  it("returns 400 when no update fields are provided", async () => {
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(makeSettingsRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("no fields to update");
  });
});

describe("PATCH /api/club/settings — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.tableData.profiles = PROFILE;
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await PATCH(makeSettingsRequest({ orgId: "org-1", orgName: "FC" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not an org member", async () => {
    mocks.tableData.organization_members = null;
    const res = await PATCH(makeSettingsRequest({ orgId: "org-1", orgName: "FC" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a director tries to update branding color", async () => {
    mocks.tableData.organization_members = { role: "director" };
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", brandColor: "#ff0000" })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when a director tries to update subdomain", async () => {
    mocks.tableData.organization_members = { role: "director" };
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "myclub" })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when a director tries to update logoUrl", async () => {
    mocks.tableData.organization_members = { role: "director" };
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", logoUrl: "https://example.com/logo.png" })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when a director tries to update faviconUrl", async () => {
    mocks.tableData.organization_members = { role: "director" };
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", faviconUrl: "https://example.com/favicon.png" })
    );
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/club/settings — subdomain validation ───────────────────────────

describe("PATCH /api/club/settings — subdomain validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
  });

  it("returns 403 when a free-plan org tries to set a subdomain", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: "free" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "myclub" })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("subdomain_requires_club_plan");
  });

  it("returns 403 when org has no plan set", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: null };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "myclub" })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("subdomain_requires_club_plan");
  });

  it("returns 409 for a reserved subdomain: 'www'", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "www" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("subdomain_reserved");
  });

  it("returns 409 for a reserved subdomain: 'api'", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "api" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("subdomain_reserved");
  });

  it("returns 409 for reserved subdomains regardless of case", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "ADMIN" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("subdomain_reserved");
  });

  it("allows clearing the subdomain (empty string) regardless of plan", async () => {
    mocks.tableData.organizations = { subdomain: "myclub", plan: "free" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "" })
    );
    // Clearing is always permitted — no plan or reserved-word check applies
    expect(res.status).toBe(200);
  });

  it("allows a valid subdomain for a club-plan org", async () => {
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", subdomain: "westside" })
    );
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/club/settings — success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
    Object.keys(mocks.updateErrors).forEach((k) => delete mocks.updateErrors[k]);
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organizations = { subdomain: null, plan: "club" };
  });

  it("returns 200 when an owner updates branding color", async () => {
    mocks.tableData.organization_members = { role: "owner" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", brandColor: "#ff0000" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 200 when an owner sets logoUrl and faviconUrl", async () => {
    mocks.tableData.organization_members = { role: "owner" };
    const res = await PATCH(
      makeSettingsRequest({
        orgId: "org-1",
        logoUrl: "https://example.com/logo.png",
        faviconUrl: "https://example.com/favicon.png",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 200 when an owner clears logoUrl and faviconUrl", async () => {
    mocks.tableData.organization_members = { role: "owner" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", logoUrl: null, faviconUrl: null })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 200 when a director updates orgName (non-branding field)", async () => {
    mocks.tableData.organization_members = { role: "director" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", orgName: "Updated Name" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 when the DB update fails", async () => {
    mocks.tableData.organization_members = { role: "owner" };
    mocks.updateErrors.organizations = { message: "db error" };
    const res = await PATCH(
      makeSettingsRequest({ orgId: "org-1", orgName: "New Name" })
    );
    expect(res.status).toBe(500);
  });
});
