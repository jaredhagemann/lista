/**
 * Unit tests for POST /api/billing/reactivate.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Reactivation" and the
 * reactivate row of "Route Authorization & State Requirements".
 *
 * Covers:
 *   - Authentication (401 when not signed in).
 *   - Input validation (orgId required).
 *   - Authorization (404 no profile / 403 non-member / 403 director).
 *   - Precondition matrix: plan ∈ {club_small, club_large} AND
 *     subscription_status = 'active' AND stripe_subscription_id IS NOT NULL
 *     AND subscription_cancel_at IS NOT NULL. Reactivating an org that
 *     isn't currently canceling is rejected (it would be a Stripe no-op but
 *     a confusing UX).
 *   - Stripe call shape: subscriptions.update with `cancel_at_period_end:
 *     false` and the org's stripe_subscription_id.
 *   - The route makes NO DB write (the webhook is the sole writer that
 *     clears subscription_cancel_at). Asserted via `mocks.updates.organizations`
 *     being undefined on the happy path.
 *
 * All Supabase and Stripe calls are mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();

  const tableData: Record<string, unknown> = {};
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
      return { eq: () => Promise.resolve({ data: null, error: null }) };
    },
  }));

  const subscriptionsUpdate = vi.fn();

  return {
    mockResolveRequestUser,
    mockFrom,
    tableData,
    updates,
    subscriptionsUpdate,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { update: mocks.subscriptionsUpdate },
  }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/billing/reactivate/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };
const CANCEL_AT = "2026-06-01T00:00:00.000Z";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/reactivate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resetState() {
  vi.clearAllMocks();
  Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
  Object.keys(mocks.updates).forEach((k) => delete mocks.updates[k]);

  mocks.subscriptionsUpdate.mockResolvedValue({
    id: "sub_existing",
    cancel_at_period_end: false,
  });
}

function seedOwner(
  org: Record<string, unknown> = {
    id: "org-1",
    plan: "club_large",
    subscription_status: "active",
    stripe_subscription_id: "sub_existing",
    subscription_cancel_at: CANCEL_AT,
  },
) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = PROFILE;
  mocks.tableData.organization_members = { role: "owner" };
  mocks.tableData.organizations = org;
}

beforeEach(() => {
  resetState();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/billing/reactivate — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/reactivate — input validation", () => {
  beforeEach(() => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 400 when orgId is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("orgId is required");
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("POST /api/billing/reactivate — authorization", () => {
  beforeEach(() => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("profile_not_found");
  });

  it("returns 403 when caller is not an org member", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = null;
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is a director (not owner)", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "director" };
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(403);
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the org row is missing", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
    mocks.tableData.organizations = null;
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_not_found");
  });
});

// ── Precondition matrix (spec auth table) ─────────────────────────────────────

describe("POST /api/billing/reactivate — precondition matrix", () => {
  it("returns 400 'not_club_plan' when plan='free'", async () => {
    seedOwner({
      id: "org-1",
      plan: "free",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: CANCEL_AT,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 'not_club_plan' for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: legacy enum must not flow through to Stripe.
    seedOwner({
      id: "org-1",
      plan: "club",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: CANCEL_AT,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
  });

  it.each([["trialing"], ["past_due"], ["canceled"], [null]])(
    "returns 400 'not_active' when subscription_status is %s",
    async (status) => {
      // Trials can't be "reactivated" because nothing has been canceled —
      // start-trial doesn't create a Stripe sub. past_due/canceled have no
      // active sub to flip. The spec restricts this route to 'active' only.
      seedOwner({
        id: "org-1",
        plan: "club_large",
        subscription_status: status,
        stripe_subscription_id: "sub_x",
        subscription_cancel_at: CANCEL_AT,
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("not_active");
      expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    },
  );

  it("returns 400 'no_subscription' when active but stripe_subscription_id is null", async () => {
    // "Managed account" pilot/admin row — there's no Stripe sub to flip.
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: null,
      subscription_cancel_at: CANCEL_AT,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_subscription");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 'not_canceling' when subscription_cancel_at is null", async () => {
    // Reactivating an org that isn't currently canceling would be a Stripe
    // no-op (cancel_at_period_end is already false), but a confusing UX.
    // Reject so the client surfaces the state mismatch.
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_canceling");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it.each([["club_small"], ["club_large"]])(
    "allows reactivate when org is %s + active + has sub + subscription_cancel_at set",
    async (plan) => {
      seedOwner({
        id: "org-1",
        plan,
        subscription_status: "active",
        stripe_subscription_id: "sub_existing",
        subscription_cancel_at: CANCEL_AT,
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    },
  );
});

// ── Stripe call shape and DB invariants ───────────────────────────────────────

describe("POST /api/billing/reactivate — Stripe call + DB invariants", () => {
  it("calls subscriptions.update with cancel_at_period_end=false and the org's sub id", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_xyz_999",
      subscription_cancel_at: CANCEL_AT,
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_xyz_999", {
      cancel_at_period_end: false,
    });
  });

  it("makes NO DB write — the webhook is the sole writer that clears subscription_cancel_at", async () => {
    // Spec invariant: the reactivate route only flips the Stripe flag; the
    // webhook (customer.subscription.updated with cancel_at_period_end=false)
    // is what clears subscription_cancel_at on the org row.
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_existing",
      subscription_cancel_at: CANCEL_AT,
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    expect(mocks.updates.organizations).toBeUndefined();
  });
});
