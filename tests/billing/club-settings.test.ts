/**
 * Unit tests for PATCH /api/club/settings
 *
 * Covers:
 *   - Auth gate (401)
 *   - Input validation (missing orgId, no fields)
 *   - Profile not found (404)
 *   - Owner-only enforcement (403)
 *   - DB update failure (500)
 *   - Happy-path branding update (200)
 *   - Cache invalidation: old subdomain busted on change
 *   - Cache invalidation: both old + new subdomain busted when subdomain changes
 *   - No cache call when no subdomain is involved
 *
 * Run via: pnpm test:integration
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInvalidateTenantCache = vi.hoisted(() =>
  vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)
);

vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: mockInvalidateTenantCache,
}));

// resolveRequestUser and adminClient come from the same module.
const mockResolveRequestUser = vi.hoisted(() => vi.fn());

// adminClient mock with per-table routing.
// The route calls .from() with four different tables; each returns a different
// query chain. A helper below rebuilds the mock per-test with the desired results.
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mockResolveRequestUser,
  adminClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import { PATCH } from "@/app/api/club/settings/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

type DbResult = { data: unknown; error: null | { message: string } };

/**
 * Configures mockFrom to return per-table results for a single test.
 *
 *   profiles            → .select().eq().single()
 *   organization_members → .select().eq().eq().single()
 *   organizations:select → .select().eq().single()
 *   organizations:update → .update().eq()
 */
function setupDb(cfg: {
  profiles?: DbResult;
  organization_members?: DbResult;
  "organizations:select"?: DbResult;
  "organizations:update"?: DbResult;
}) {
  const ok: DbResult = { data: null, error: null };

  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") {
      const res = cfg.profiles ?? ok;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(res),
          }),
        }),
      };
    }

    if (table === "organization_members") {
      const res = cfg.organization_members ?? ok;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(res),
            }),
          }),
        }),
      };
    }

    if (table === "organizations") {
      const selectRes = cfg["organizations:select"] ?? ok;
      const updateRes = cfg["organizations:update"] ?? ok;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(selectRes),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(updateRes),
        }),
      };
    }

    return { select: vi.fn(), update: vi.fn() };
  });
}

function makeRequest(body: object, token = "tok_user"): Request {
  return new Request("http://localhost/api/club/settings", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const OWNER_USER = { id: "auth-user-1" };
const PROFILE_ID = "profile-1";
const ORG_ID = "org-abc";

beforeEach(() => {
  mockInvalidateTenantCache.mockClear();
  mockFrom.mockReset();
  mockResolveRequestUser.mockResolvedValue(OWNER_USER);
});

// ── Auth & validation ─────────────────────────────────────────────────────────

describe("PATCH /api/club/settings — auth and validation", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockResolveRequestUser.mockResolvedValue(null);

    const response = await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(response.status).toBe(401);
  });

  it("returns 400 when orgId is missing", async () => {
    const response = await PATCH(makeRequest({ brandColor: "#ff0000" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/orgId/i);
  });

  it("returns 400 when no updatable fields are provided", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: null }, error: null },
    });

    const response = await PATCH(makeRequest({ orgId: ORG_ID }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no fields/i);
  });
});

// ── Owner-only enforcement ────────────────────────────────────────────────────

describe("PATCH /api/club/settings — owner enforcement", () => {
  it("returns 404 when the caller has no profile", async () => {
    setupDb({ profiles: { data: null, error: null } });

    const response = await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(response.status).toBe(404);
  });

  it("returns 403 when the caller is not an org member", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: null, error: null },
    });

    const response = await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(response.status).toBe(403);
  });

  it("returns 403 when the caller is a non-owner member", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "manager" }, error: null },
    });

    const response = await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(response.status).toBe(403);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe("PATCH /api/club/settings — happy path", () => {
  it("returns 200 { ok: true } when the update succeeds", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: null }, error: null },
      "organizations:update": { data: null, error: null },
    });

    const response = await PATCH(
      makeRequest({ orgId: ORG_ID, brandColor: "#1a1a2e", orgNamePublic: "Joga FC" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 when the DB update fails", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: null }, error: null },
      "organizations:update": { data: null, error: { message: "constraint violation" } },
    });

    const response = await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(response.status).toBe(500);
  });
});

// ── Cache invalidation ────────────────────────────────────────────────────────

describe("PATCH /api/club/settings — cache invalidation", () => {
  it("invalidates the old subdomain when a new subdomain replaces it", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: "oldslug" }, error: null },
      "organizations:update": { data: null, error: null },
    });

    await PATCH(makeRequest({ orgId: ORG_ID, subdomain: "newslug" }));

    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("oldslug.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("newslug.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(2);
  });

  it("only invalidates the old subdomain when the subdomain is not being changed", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: "jogafc" }, error: null },
      "organizations:update": { data: null, error: null },
    });

    // Only updating branding, not the subdomain
    await PATCH(makeRequest({ orgId: ORG_ID, brandColor: "#ff0000" }));

    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("jogafc.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(1);
  });

  it("does not call invalidateTenantCache when no subdomain is involved", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: null }, error: null },
      "organizations:update": { data: null, error: null },
    });

    await PATCH(makeRequest({ orgId: ORG_ID, orgNamePublic: "New Name" }));

    expect(mockInvalidateTenantCache).not.toHaveBeenCalled();
  });

  it("invalidates only the old subdomain when subdomain is cleared (set to empty string)", async () => {
    setupDb({
      profiles: { data: { id: PROFILE_ID }, error: null },
      organization_members: { data: { role: "owner" }, error: null },
      "organizations:select": { data: { subdomain: "jogafc" }, error: null },
      "organizations:update": { data: null, error: null },
    });

    await PATCH(makeRequest({ orgId: ORG_ID, subdomain: "" }));

    // subdomain "" is treated as null (cleared). Old key busted, no new key.
    expect(mockInvalidateTenantCache).toHaveBeenCalledWith("jogafc.lista.team");
    expect(mockInvalidateTenantCache).toHaveBeenCalledTimes(1);
  });
});
