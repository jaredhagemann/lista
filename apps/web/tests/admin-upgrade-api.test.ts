/**
 * Unit tests for POST /api/admin/upgrade.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Admin manual upgrade",
 * "Route Authorization & State Requirements", and the "Admin upgrade" section
 * of the Testing Checklist.
 *
 * Covers:
 *   - Authentication (401 when unauthenticated; 404 when ADMIN_UPGRADE_CODE
 *     env var is unset to keep the route invisible in production)
 *   - Input validation (orgId, plan must be club_small | club_large; retired
 *     legacy 'club' literal is rejected; arbitrary plan values are rejected)
 *   - Code gate (403 for invalid code) and owner gate (403 for non-owners)
 *   - Tier writes: club_small → team_limit=10, club_large → team_limit=null,
 *     both → subscription_status='active'
 *   - Stripe fields (stripe_customer_id, stripe_subscription_id) are NEVER
 *     written by this route — confirmed via update-payload assertions
 *   - trial_ends_at set-once behaviour: stamped on first upgrade, never
 *     overwritten on subsequent upgrades. Combined with start-trial's
 *     `trial_ends_at IS NULL` gate, this is how admin-upgraded orgs are
 *     locked out of the self-serve trial flow.
 *
 * All Supabase calls are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();

  const tableData: Record<string, unknown> = {};
  const updateErrors: Record<string, object | null> = {};
  const updates: Record<string, unknown[]> = {};

  const makeChain = (val: unknown): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const chain: Record<string, unknown> = {
      eq: () => makeChain(val),
      in: () => makeChain(val),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: () => makeChain(tableData[table] ?? null),
    update: (vals: unknown) => {
      (updates[table] ??= []).push(vals);
      return {
        eq: () =>
          Promise.resolve({ data: null, error: updateErrors[table] ?? null }),
      };
    },
  }));

  return { mockResolveRequestUser, mockFrom, tableData, updateErrors, updates };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/admin/upgrade/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };
const CODE = "test-code";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resetState() {
  vi.clearAllMocks();
  Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
  Object.keys(mocks.updateErrors).forEach((k) => delete mocks.updateErrors[k]);
  Object.keys(mocks.updates).forEach((k) => delete mocks.updates[k]);
  process.env.ADMIN_UPGRADE_CODE = CODE;
}

function seedOwner(org: Record<string, unknown> = { trial_ends_at: null }) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = PROFILE;
  mocks.tableData.organization_members = { role: "owner" };
  mocks.tableData.organizations = org;
}

afterEach(() => {
  process.env.ADMIN_UPGRADE_CODE = CODE;
});

// ── Env / availability ────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — availability", () => {
  beforeEach(resetState);

  it("returns 404 when ADMIN_UPGRADE_CODE is unset", async () => {
    // Production safety: with no code configured the route is hidden entirely
    // (404 rather than 403) so it can't be enumerated.
    delete process.env.ADMIN_UPGRADE_CODE;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_available" });
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — authentication", () => {
  beforeEach(resetState);

  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — input validation", () => {
  beforeEach(() => {
    resetState();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 400 when orgId is missing", async () => {
    const res = await POST(makeRequest({ plan: "club_small", code: CODE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("orgId is required");
  });

  it("returns 400 when plan is missing", async () => {
    const res = await POST(makeRequest({ orgId: "org-1", code: CODE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "plan must be 'club_small' or 'club_large'"
    );
  });

  it("returns 400 for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: the route was previously hardcoded to plan='club'.
    // Reject it explicitly so a stale client (e.g. cached JS) cannot upgrade
    // an org back to the retired enum value.
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club", code: CODE })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "plan must be 'club_small' or 'club_large'"
    );
  });

  it("returns 400 for an arbitrary unknown plan value", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "enterprise", code: CODE })
    );
    expect(res.status).toBe(400);
  });
});

// ── Code gate ─────────────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — code gate", () => {
  beforeEach(() => {
    resetState();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 403 when code is missing", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_code");
  });

  it("returns 403 when code does not match ADMIN_UPGRADE_CODE", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: "wrong" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_code");
    // Critical: a wrong code must never produce a DB write.
    expect(mocks.updates.organizations).toBeUndefined();
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — authorization", () => {
  beforeEach(() => {
    resetState();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("profile_not_found");
  });

  it("returns 403 when caller is not an org member", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("returns 403 when caller is a director (not owner)", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "director" };
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(403);
    expect(mocks.updates.organizations).toBeUndefined();
  });

  it("returns 404 when the org row is missing", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
    mocks.tableData.organizations = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_not_found");
  });
});

// ── Tier writes ───────────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — tier writes", () => {
  beforeEach(resetState);

  it("upgrades to club_small with team_limit=10 and subscription_status='active'", async () => {
    seedOwner({ trial_ends_at: null });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mocks.updates.organizations).toHaveLength(1);
    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.plan).toBe("club_small");
    expect(payload.team_limit).toBe(10);
    expect(payload.subscription_status).toBe("active");
    // Stripe fields must never be written by this route.
    expect(payload).not.toHaveProperty("stripe_customer_id");
    expect(payload).not.toHaveProperty("stripe_subscription_id");
  });

  it("upgrades to club_large with team_limit=null (unlimited) and subscription_status='active'", async () => {
    seedOwner({ trial_ends_at: null });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large", code: CODE })
    );
    expect(res.status).toBe(200);

    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.plan).toBe("club_large");
    // null (not undefined) — explicitly written so a previous team_limit of 10
    // (from a prior club_small upgrade) is reset to unlimited.
    expect(payload.team_limit).toBeNull();
    expect(payload.subscription_status).toBe("active");
    expect(payload).not.toHaveProperty("stripe_customer_id");
    expect(payload).not.toHaveProperty("stripe_subscription_id");
  });
});

// ── trial_ends_at set-once behaviour ──────────────────────────────────────────

describe("POST /api/admin/upgrade — trial_ends_at set-once", () => {
  beforeEach(resetState);

  it("stamps trial_ends_at=now() when previously NULL", async () => {
    seedOwner({ trial_ends_at: null });
    const before = Date.now();
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    const after = Date.now();
    expect(res.status).toBe(200);

    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(typeof payload.trial_ends_at).toBe("string");
    const stamped = Date.parse(payload.trial_ends_at as string);
    expect(stamped).toBeGreaterThanOrEqual(before - 2000);
    expect(stamped).toBeLessThanOrEqual(after + 2000);
  });

  it("does NOT overwrite trial_ends_at when already set (set-once)", async () => {
    // The existing value is the permanent trial-consumed record; overwriting
    // it would reset the "trial already used" gate. Critical invariant.
    seedOwner({ trial_ends_at: "2025-01-15T00:00:00.000Z" });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large", code: CODE })
    );
    expect(res.status).toBe(200);

    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("trial_ends_at");
    // Plan/limit/status still update normally.
    expect(payload.plan).toBe("club_large");
    expect(payload.team_limit).toBeNull();
    expect(payload.subscription_status).toBe("active");
  });

  it("locks the org out of a subsequent self-serve trial (trial_ends_at gate)", async () => {
    // Indirect verification of the cross-route invariant from the spec's
    // testing checklist: "Admin-upgraded org cannot later claim a self-serve
    // trial". The admin route stamps trial_ends_at on first upgrade; the
    // start-trial route's `trial_ends_at IS NULL` precondition does the
    // actual rejection. Here we confirm the stamp happens.
    seedOwner({ trial_ends_at: null });
    await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.trial_ends_at).not.toBeNull();
    expect(payload.trial_ends_at).not.toBeUndefined();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("POST /api/admin/upgrade — error handling", () => {
  beforeEach(resetState);

  it("returns 500 when the DB update fails", async () => {
    seedOwner({ trial_ends_at: null });
    mocks.updateErrors.organizations = { message: "db error" };
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small", code: CODE })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db error");
  });
});
