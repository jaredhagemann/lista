/**
 * Unit tests for POST /api/billing/cancel.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Cancel Subscription" and
 * the cancel row of "Route Authorization & State Requirements".
 *
 * Covers:
 *   - Authentication (401 when not signed in).
 *   - Input validation (orgId required).
 *   - Authorization (404 no profile / 403 non-member / 403 director).
 *   - Precondition matrix: plan ∈ {club_small, club_large} AND
 *     subscription_status = 'active' AND stripe_subscription_id IS NOT NULL
 *     AND subscription_cancel_at IS NULL AND pending_plan IS NULL. Anything
 *     else is rejected with a stable JSON error key so the UI can branch.
 *   - Stripe call shape: subscriptions.update with `cancel_at_period_end: true`
 *     and the org's stripe_subscription_id.
 *   - The route makes NO DB write (the webhook is the sole writer of
 *     subscription_cancel_at). Asserted via `mocks.updates.organizations`
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

import { POST } from "@/app/api/billing/cancel/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/cancel", {
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
    cancel_at_period_end: true,
  });
}

function seedOwner(
  org: Record<string, unknown> = {
    id: "org-1",
    plan: "club_large",
    subscription_status: "active",
    stripe_subscription_id: "sub_existing",
    subscription_cancel_at: null,
    pending_plan: null,
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

describe("POST /api/billing/cancel — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No Stripe interaction must occur on unauthenticated requests.
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/cancel — input validation", () => {
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

describe("POST /api/billing/cancel — authorization", () => {
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

describe("POST /api/billing/cancel — precondition matrix", () => {
  it("returns 400 'not_club_plan' when plan='free'", async () => {
    seedOwner({
      id: "org-1",
      plan: "free",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: null,
      pending_plan: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 'not_club_plan' for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: a stale row with the retired enum value must not
    // reach the Stripe call.
    seedOwner({
      id: "org-1",
      plan: "club",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: null,
      pending_plan: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
  });

  it.each([["trialing"], ["past_due"], ["canceled"], [null]])(
    "returns 400 'not_active' when subscription_status is %s",
    async (status) => {
      seedOwner({
        id: "org-1",
        plan: "club_large",
        subscription_status: status,
        stripe_subscription_id: "sub_x",
        subscription_cancel_at: null,
        pending_plan: null,
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("not_active");
      expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    },
  );

  it("returns 400 'no_subscription' when active but stripe_subscription_id is null", async () => {
    // The "Managed account" pilot/admin-upgrade row — active without a Stripe
    // sub. The spec mandates stripe_subscription_id IS NOT NULL on cancel
    // because there's literally nothing in Stripe to set the flag on.
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: null,
      subscription_cancel_at: null,
      pending_plan: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_subscription");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 'already_canceling' when subscription_cancel_at is already set", async () => {
    // Calling cancel twice is a UX bug, not a Stripe edge case — Stripe would
    // happily ack a second `cancel_at_period_end=true`. Reject so the UI can
    // re-fetch state instead of silently confirming an already-confirmed action.
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: "2026-06-01T00:00:00.000Z",
      pending_plan: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("already_canceling");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 'pending_plan_change' when a Large→Small schedule is pending", async () => {
    // A deferred downgrade and a full cancellation are mutually exclusive in
    // Stripe — cancelling on top of a schedule would orphan the schedule and
    // leave the webhook flow ambiguous (subscription_schedule.* events would
    // race customer.subscription.deleted). Reject so the UI directs the user
    // to undo the downgrade first.
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      subscription_cancel_at: null,
      pending_plan: "club_small",
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pending_plan_change");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it.each([["club_small"], ["club_large"]])(
    "allows cancel when org is %s + active + has sub + no pending state",
    async (plan) => {
      seedOwner({
        id: "org-1",
        plan,
        subscription_status: "active",
        stripe_subscription_id: "sub_existing",
        subscription_cancel_at: null,
        pending_plan: null,
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    },
  );
});

// ── Stripe call shape and DB invariants ───────────────────────────────────────

describe("POST /api/billing/cancel — Stripe call + DB invariants", () => {
  it("calls subscriptions.update with cancel_at_period_end=true and the org's sub id", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_abc_123",
      subscription_cancel_at: null,
      pending_plan: null,
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_abc_123", {
      cancel_at_period_end: true,
    });
  });

  it("makes NO DB write — the webhook is the sole writer of subscription_cancel_at", async () => {
    // Spec invariant: the cancel route only flips the Stripe flag; the
    // webhook (customer.subscription.updated with cancel_at_period_end=true)
    // is what stamps subscription_cancel_at on the org row. Pre-empting it
    // here would risk a stale value if the period end shifts in Stripe.
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_existing",
      subscription_cancel_at: null,
      pending_plan: null,
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    // Asserts the route does not touch the organizations table at all.
    expect(mocks.updates.organizations).toBeUndefined();
  });
});
