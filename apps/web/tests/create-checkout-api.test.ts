/**
 * Unit tests for POST /api/billing/create-checkout.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Route Authorization & State
 * Requirements" (create-checkout row), "Re-subscribing after cancellation",
 * and "Stripe Integration → Products & Prices".
 *
 * Covers:
 *   - Authentication (401 when not signed in).
 *   - Input validation (orgId required; plan must be club_small | club_large;
 *     retired legacy 'club' literal is rejected explicitly).
 *   - Authorization (404 no profile / 403 non-member / 403 director).
 *   - Precondition matrix from the spec auth table — only `plan='free'` (any
 *     status) and `club_* + canceled` are allowed.
 *   - Tier price selection (club_small → STRIPE_CLUB_SMALL_PRICE_ID;
 *     club_large → STRIPE_CLUB_LARGE_PRICE_ID).
 *   - Stripe customer create/reuse and customer-id persistence.
 *   - Active-subscription guard (rejects when Stripe reports an active sub
 *     before the webhook has landed; prevents a double-subscribe race).
 *   - Stale-canceled reset (`stripe_subscription_id` + `subscription_status`
 *     cleared on re-upgrade so the webhook can write fresh values without
 *     colliding).
 *   - Idempotency key includes the tier so a follow-up checkout for a
 *     different tier within the 24h idempotency window produces a fresh
 *     session.
 *   - Checkout session metadata / mode / urls.
 *
 * All Supabase and Stripe calls are mocked — no network required.
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

  const customersCreate = vi.fn();
  const subscriptionsList = vi.fn();
  const checkoutSessionsCreate = vi.fn();

  return {
    mockResolveRequestUser,
    mockFrom,
    tableData,
    updateErrors,
    updates,
    customersCreate,
    subscriptionsList,
    checkoutSessionsCreate,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: { create: mocks.customersCreate },
    subscriptions: { list: mocks.subscriptionsList },
    checkout: { sessions: { create: mocks.checkoutSessionsCreate } },
  }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/billing/create-checkout/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };
const SMALL_PRICE = "price_test_small_abc";
const LARGE_PRICE = "price_test_large_xyz";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/create-checkout", {
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

  // Default happy-path Stripe responses; tests override per-case.
  mocks.customersCreate.mockResolvedValue({ id: "cus_new_default" });
  mocks.subscriptionsList.mockResolvedValue({ data: [] });
  mocks.checkoutSessionsCreate.mockResolvedValue({
    id: "cs_test_default",
    url: "https://checkout.stripe.test/cs_test_default",
  });
}

function seedOwner(
  org: Record<string, unknown> = {
    id: "org-1",
    name: "Test Org",
    stripe_customer_id: null,
    plan: "free",
    subscription_status: null,
  },
) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = PROFILE;
  mocks.tableData.organization_members = { role: "owner" };
  mocks.tableData.organizations = org;
}

beforeEach(() => {
  resetState();
  vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_PRICE);
  vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_PRICE);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.lista.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/billing/create-checkout — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No Stripe call must occur for unauthenticated requests.
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/create-checkout — input validation", () => {
  beforeEach(() => {
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
      "plan must be 'club_small' or 'club_large'",
    );
  });

  it("returns 400 for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: the route was hardcoded to plan='club' before the tier
    // split. Reject the literal explicitly so a stale client can't request a
    // checkout for the retired enum value (which has no env-configured price).
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "plan must be 'club_small' or 'club_large'",
    );
  });

  it("returns 400 for an arbitrary unknown plan value", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "enterprise" }),
    );
    expect(res.status).toBe(400);
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("POST /api/billing/create-checkout — authorization", () => {
  beforeEach(() => {
    mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  });

  it("returns 404 when caller has no profiles row", async () => {
    mocks.tableData.profiles = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("profile_not_found");
  });

  it("returns 403 when caller is not an org member", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("returns 403 when caller is a director (not owner)", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "director" };
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(403);
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the org row is missing", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "owner" };
    mocks.tableData.organizations = null;
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_not_found");
  });
});

// ── Precondition matrix (spec auth table) ─────────────────────────────────────

describe("POST /api/billing/create-checkout — precondition matrix", () => {
  it.each([
    ["club_small", "active"],
    ["club_small", "trialing"],
    ["club_small", "past_due"],
    ["club_large", "active"],
    ["club_large", "trialing"],
    ["club_large", "past_due"],
  ])(
    "rejects checkout with 400 'already_subscribed' when org is %s + %s",
    async (plan, status) => {
      seedOwner({
        id: "org-1",
        name: "Test Org",
        stripe_customer_id: null,
        plan,
        subscription_status: status,
      });
      const res = await POST(
        makeRequest({ orgId: "org-1", plan: "club_large" }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("already_subscribed");
      // No Stripe call must be made when the precondition fails.
      expect(mocks.customersCreate).not.toHaveBeenCalled();
      expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["free", null],
    ["free", "canceled"],
    ["club_small", "canceled"],
    ["club_large", "canceled"],
  ])(
    "allows checkout when org is %s + %s",
    async (plan, status) => {
      seedOwner({
        id: "org-1",
        name: "Test Org",
        stripe_customer_id: null,
        plan,
        subscription_status: status,
      });
      const res = await POST(
        makeRequest({ orgId: "org-1", plan: "club_small" }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).url).toMatch(/^https:\/\//);
      expect(mocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    },
  );
});

// ── Tier price selection ──────────────────────────────────────────────────────

describe("POST /api/billing/create-checkout — tier price selection", () => {
  it("uses STRIPE_CLUB_SMALL_PRICE_ID when plan='club_small'", async () => {
    seedOwner();
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.line_items[0].price).toBe(SMALL_PRICE);
    expect(sessionArgs.line_items[0].quantity).toBe(1);
  });

  it("uses STRIPE_CLUB_LARGE_PRICE_ID when plan='club_large'", async () => {
    seedOwner();
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);

    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.line_items[0].price).toBe(LARGE_PRICE);
  });

  it("returns 500 when the requested tier's price env var is unset", async () => {
    // priceIdForPlan throws synchronously on missing env. Without env
    // checks the route lets the throw bubble — Next renders this as a 500.
    // We assert by promise-rejection rather than an HTTP code because the
    // route does not catch the throw (matches start-trial's contract too).
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", "");
    seedOwner();
    await expect(
      POST(makeRequest({ orgId: "org-1", plan: "club_small" })),
    ).rejects.toThrow(/STRIPE_CLUB_SMALL_PRICE_ID/);
  });
});

// ── Stripe customer create / reuse ────────────────────────────────────────────

describe("POST /api/billing/create-checkout — Stripe customer handling", () => {
  it("creates a new Stripe customer and persists stripe_customer_id when none exists", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: null,
      plan: "free",
      subscription_status: null,
    });
    mocks.customersCreate.mockResolvedValue({ id: "cus_brand_new" });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    // Customer created with org metadata so the webhook can match it later.
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      name: "Test Org",
      metadata: { org_id: "org-1" },
    });

    // Customer id persisted to the org row before the checkout call.
    const orgUpdates = mocks.updates.organizations ?? [];
    const customerUpdate = orgUpdates.find(
      (u) =>
        (u as Record<string, unknown>).stripe_customer_id === "cus_brand_new",
    );
    expect(customerUpdate).toBeDefined();

    // Stripe active-subscription list MUST NOT be queried for a brand-new
    // customer (there can't be any prior subs).
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();

    // Checkout session created with the persisted customer id.
    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.customer).toBe("cus_brand_new");
  });

  it("reuses the existing stripe_customer_id without creating a new customer", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing_xyz",
      plan: "free",
      subscription_status: null,
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    expect(mocks.customersCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsList).toHaveBeenCalledTimes(1);

    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.customer).toBe("cus_existing_xyz");
  });
});

// ── Active-subscription guard (race protection) ───────────────────────────────

describe("POST /api/billing/create-checkout — active-subscription guard", () => {
  it("returns 400 'already_subscribed' when Stripe reports an active subscription", async () => {
    // Defends against a race: the webhook for a previous checkout hasn't yet
    // flipped subscription_status, but Stripe already knows about the active
    // sub. Without this guard we would open a second concurrent subscription.
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "free",
      subscription_status: null,
    });
    mocks.subscriptionsList.mockResolvedValue({
      data: [{ id: "sub_already_active" }],
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("already_subscribed");
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("queries Stripe for active subscriptions only (limit 1)", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "free",
      subscription_status: null,
    });
    await POST(makeRequest({ orgId: "org-1", plan: "club_small" }));
    expect(mocks.subscriptionsList).toHaveBeenCalledWith({
      customer: "cus_existing",
      status: "active",
      limit: 1,
    });
  });
});

// ── Stale-canceled reset (re-upgrade flow) ────────────────────────────────────

describe("POST /api/billing/create-checkout — stale-canceled reset", () => {
  it("clears stripe_subscription_id and subscription_status when status='canceled'", async () => {
    // After cancellation the org row carries `subscription_status='canceled'`
    // and the previous sub id. The webhook for the new checkout would not
    // overwrite a canceled row safely, so this route nulls those fields first.
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "club_large",
      subscription_status: "canceled",
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);

    const orgUpdates = mocks.updates.organizations ?? [];
    const resetUpdate = orgUpdates.find((u) => {
      const o = u as Record<string, unknown>;
      return (
        o.stripe_subscription_id === null &&
        o.subscription_status === null
      );
    });
    expect(resetUpdate).toBeDefined();
  });

  it("does NOT issue a stale-canceled reset when status is null (fresh upgrade)", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "free",
      subscription_status: null,
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    const orgUpdates = mocks.updates.organizations ?? [];
    // No update payload should contain {subscription_status:null,
    // stripe_subscription_id:null} when nothing needed clearing.
    const resetUpdate = orgUpdates.find((u) => {
      const o = u as Record<string, unknown>;
      return (
        o.stripe_subscription_id === null &&
        o.subscription_status === null
      );
    });
    expect(resetUpdate).toBeUndefined();
  });
});

// ── Checkout session shape ────────────────────────────────────────────────────

describe("POST /api/billing/create-checkout — session shape", () => {
  it("creates a subscription-mode session with org metadata and configured URLs", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "free",
      subscription_status: null,
    });

    await POST(makeRequest({ orgId: "org-1", plan: "club_small" }));

    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    const [args, opts] = mocks.checkoutSessionsCreate.mock.calls[0];

    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_existing");
    expect(args.metadata).toEqual({ org_id: "org-1" });
    expect(args.success_url).toBe(
      "https://app.lista.test/dashboard/settings?billing=success",
    );
    expect(args.cancel_url).toBe(
      "https://app.lista.test/dashboard/settings?billing=canceled",
    );

    // Idempotency key includes (orgId, tier) so a follow-up checkout for a
    // different tier within Stripe's 24h idempotency window produces a fresh
    // session instead of returning the cached one for the prior tier.
    expect(opts.idempotencyKey).toBe("checkout-org-1-club_small");
  });

  it("produces different idempotency keys for club_small vs club_large", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      stripe_customer_id: "cus_existing",
      plan: "free",
      subscription_status: null,
    });

    await POST(makeRequest({ orgId: "org-1", plan: "club_small" }));
    await POST(makeRequest({ orgId: "org-1", plan: "club_large" }));

    const keys = mocks.checkoutSessionsCreate.mock.calls.map(
      (c) => c[1].idempotencyKey,
    );
    expect(keys).toEqual([
      "checkout-org-1-club_small",
      "checkout-org-1-club_large",
    ]);
  });

  it("returns the session URL to the caller", async () => {
    seedOwner();
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_test_specific",
      url: "https://checkout.stripe.test/cs_test_specific",
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/cs_test_specific",
    });
  });
});
