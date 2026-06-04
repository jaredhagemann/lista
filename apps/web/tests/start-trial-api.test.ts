/**
 * Unit tests for POST /api/billing/start-trial.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Starting a Trial",
 * "Route Authorization & State Requirements".
 *
 * Covers:
 *   - Authentication (401 when not signed in)
 *   - Input validation (orgId required, plan must be club_small | club_large)
 *   - Authorization (403 for non-owners)
 *   - Preconditions: plan='free', trial_ends_at IS NULL,
 *     stripe_subscription_id IS NULL
 *   - Both tiers (club_small → team_limit 10; club_large → team_limit null)
 *   - Trial duration is exactly 90 days
 *   - The "trial_already_used" gate fires regardless of why trial_ends_at is set
 *     (previous trial, legacy backfill, etc.)
 *
 * All Supabase calls are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();

  // Per-table query results returned by .single()/.maybeSingle()/await.
  const tableData: Record<string, unknown> = {};
  // Per-table update errors (null = success).
  const updateErrors: Record<string, object | null> = {};
  // Per-table captured update payloads, in the order updates were applied.
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

import { POST } from "@/app/api/billing/start-trial/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/start-trial", {
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
}

function seedOwner(
  org: Record<string, unknown> = {
    plan: "free",
    trial_ends_at: null,
    stripe_subscription_id: null,
  }
) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = PROFILE;
  mocks.tableData.organization_members = { role: "owner" };
  mocks.tableData.organizations = org;
}

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/billing/start-trial — authentication", () => {
  beforeEach(resetState);

  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/start-trial — input validation", () => {
  beforeEach(() => {
    resetState();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 400 when orgId is missing", async () => {
    const res = await POST(makeRequest({ plan: "club_small" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("orgId is required");
  });

  it("returns 400 when plan is missing", async () => {
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "plan must be 'club_small' or 'club_large'"
    );
  });

  it("returns 400 for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: the start-trial route is the only entry point for a
    // self-serve trial, so it must reject the retired plan literal even though
    // no client sends it today.
    const res = await POST(makeRequest({ orgId: "org-1", plan: "club" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "plan must be 'club_small' or 'club_large'"
    );
  });

  it("returns 400 for an arbitrary unknown plan value", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "enterprise" })
    );
    expect(res.status).toBe(400);
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("POST /api/billing/start-trial — authorization", () => {
  beforeEach(() => {
    resetState();
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("profile_not_found");
  });

  it("returns 403 when caller is not an org member", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("returns 403 when caller is a director (not owner)", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "director" };
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when the org row is missing", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
    mocks.tableData.organizations = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_not_found");
  });
});

// ── Preconditions ─────────────────────────────────────────────────────────────

describe("POST /api/billing/start-trial — preconditions", () => {
  beforeEach(resetState);

  it("returns 400 when current plan is not 'free' (already on a club tier)", async () => {
    seedOwner({
      plan: "club_small",
      trial_ends_at: null,
      stripe_subscription_id: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_free_plan");
    expect(mocks.updates.organizations).toBeUndefined();
  });

  it("returns 400 'trial_already_used' when trial_ends_at is set", async () => {
    seedOwner({
      plan: "free",
      trial_ends_at: "2025-01-15T00:00:00.000Z",
      stripe_subscription_id: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(400);
    // The "trial already used" gate routes the user to checkout — keep the
    // error key stable so the UI can branch on it without parsing prose.
    expect((await res.json()).error).toBe("trial_already_used");
    expect(mocks.updates.organizations).toBeUndefined();
  });

  it("returns 400 'trial_already_used' even when trial_ends_at is in the future", async () => {
    // Belt-and-braces: the field is the permanent "trial consumed" marker —
    // the actual value doesn't matter, only the IS NOT NULL gate.
    seedOwner({
      plan: "free",
      trial_ends_at: "2099-12-31T00:00:00.000Z",
      stripe_subscription_id: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("trial_already_used");
  });

  it("returns 400 'subscription_exists' when stripe_subscription_id is set", async () => {
    seedOwner({
      plan: "free",
      trial_ends_at: null,
      stripe_subscription_id: "sub_123",
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("subscription_exists");
    expect(mocks.updates.organizations).toBeUndefined();
  });
});

// ── Success — both tiers ──────────────────────────────────────────────────────

describe("POST /api/billing/start-trial — success", () => {
  beforeEach(resetState);

  it("starts a Club Small trial: sets plan, team_limit=10, subscription_status='trialing'", async () => {
    seedOwner();
    const before = Date.now();
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.trialEndsAt).toBe("string");

    // Exactly one update applied to organizations.
    expect(mocks.updates.organizations).toHaveLength(1);
    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.plan).toBe("club_small");
    expect(payload.subscription_status).toBe("trialing");
    expect(payload.team_limit).toBe(10);
    expect(typeof payload.trial_ends_at).toBe("string");

    // Trial duration is 90 days from now (±2s for clock jitter).
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const trialMs = Date.parse(payload.trial_ends_at as string);
    expect(trialMs).toBeGreaterThanOrEqual(before + NINETY_DAYS - 2000);
    expect(trialMs).toBeLessThanOrEqual(after + NINETY_DAYS + 2000);

    // Response trialEndsAt must equal what was written so the UI doesn't need
    // a follow-up GET to display the date.
    expect(body.trialEndsAt).toBe(payload.trial_ends_at);
  });

  it("starts a Club Large trial: sets plan, team_limit=null (unlimited), subscription_status='trialing'", async () => {
    seedOwner();
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" })
    );
    expect(res.status).toBe(200);

    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.plan).toBe("club_large");
    expect(payload.team_limit).toBeNull();
    expect(payload.subscription_status).toBe("trialing");
    expect(typeof payload.trial_ends_at).toBe("string");
  });

  it("returns 500 when the DB update fails", async () => {
    seedOwner();
    mocks.updateErrors.organizations = { message: "db error" };
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db error");
  });
});
