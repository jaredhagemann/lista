/**
 * Unit tests for POST /api/billing/create-setup.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Adding Payment Method
 * During Trial" and "Route Authorization & State Requirements"
 * (create-setup row).
 *
 * Covers:
 *   - Authentication (401 when not signed in).
 *   - Input validation (orgId required).
 *   - Authorization (404 no profile / 403 non-member / 403 director).
 *   - Precondition matrix: plan ∈ {club_small, club_large} AND
 *     subscription_status = 'trialing'. Anything else is rejected with a
 *     stable JSON error key so the UI can branch.
 *   - Stripe customer create-with-persistence vs reuse — the trial flow has
 *     no prior Stripe interaction, so this route is typically where the
 *     customer is born.
 *   - Setup session shape: `mode: 'setup'`, no line items, no `customer_update`
 *     flag, `metadata.org_id`, configured return URLs, idempotency key scoped
 *     to the org (no tier suffix — setup sessions are tier-independent).
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
  const checkoutSessionsCreate = vi.fn();

  return {
    mockResolveRequestUser,
    mockFrom,
    tableData,
    updateErrors,
    updates,
    customersCreate,
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
    checkout: { sessions: { create: mocks.checkoutSessionsCreate } },
  }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/billing/create-setup/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/create-setup", {
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
  mocks.checkoutSessionsCreate.mockResolvedValue({
    id: "cs_setup_default",
    url: "https://checkout.stripe.test/cs_setup_default",
  });
}

function seedOwner(
  org: Record<string, unknown> = {
    id: "org-1",
    name: "Test Org",
    plan: "club_small",
    subscription_status: "trialing",
    stripe_customer_id: null,
  },
) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = PROFILE;
  mocks.tableData.organization_members = { role: "owner" };
  mocks.tableData.organizations = org;
}

beforeEach(() => {
  resetState();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.lista.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/billing/create-setup — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No Stripe call must occur for unauthenticated requests.
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/create-setup — input validation", () => {
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

describe("POST /api/billing/create-setup — authorization", () => {
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
  });

  it("returns 403 when caller is a director (not owner)", async () => {
    mocks.tableData.profiles = PROFILE;
    mocks.tableData.organization_members = { role: "director" };
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(403);
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
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

describe("POST /api/billing/create-setup — precondition matrix", () => {
  it("returns 400 'not_club_plan' when plan='free'", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "free",
      subscription_status: "trialing",
      stripe_customer_id: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    expect(mocks.customersCreate).not.toHaveBeenCalled();
  });

  it("returns 400 'not_club_plan' for the retired legacy 'club' plan value", async () => {
    // Defence-in-depth: a stale row with the retired enum value must not be
    // able to claim a setup session — it would imply the migration backfill
    // failed and the route should refuse rather than silently proceed.
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club",
      subscription_status: "trialing",
      stripe_customer_id: null,
    });
    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
  });

  it.each([
    ["club_small", "active"],
    ["club_small", "past_due"],
    ["club_small", "canceled"],
    ["club_small", null],
    ["club_large", "active"],
    ["club_large", "past_due"],
    ["club_large", "canceled"],
    ["club_large", null],
  ])(
    "returns 400 'not_trialing' when org is %s + %s",
    async (plan, status) => {
      seedOwner({
        id: "org-1",
        name: "Test Org",
        plan,
        subscription_status: status,
        stripe_customer_id: null,
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("not_trialing");
      // No Stripe interaction when the precondition fails. The setup session
      // must not be created on a non-trialing org because the customer-default
      // payment-method flow is specifically the trial → conversion path.
      expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
      expect(mocks.customersCreate).not.toHaveBeenCalled();
    },
  );

  it.each([["club_small"], ["club_large"]])(
    "allows setup when org is %s + trialing",
    async (plan) => {
      seedOwner({
        id: "org-1",
        name: "Test Org",
        plan,
        subscription_status: "trialing",
        stripe_customer_id: "cus_existing",
      });
      const res = await POST(makeRequest({ orgId: "org-1" }));
      expect(res.status).toBe(200);
      expect((await res.json()).url).toMatch(/^https:\/\//);
      expect(mocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    },
  );
});

// ── Stripe customer create / reuse ────────────────────────────────────────────

describe("POST /api/billing/create-setup — Stripe customer handling", () => {
  it("creates a new Stripe customer and persists stripe_customer_id when none exists", async () => {
    // The trial flow makes no Stripe call up front (start-trial is DB-only),
    // so the first time a trialing owner clicks "Add payment method" we have
    // to create the customer.
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club_large",
      subscription_status: "trialing",
      stripe_customer_id: null,
    });
    mocks.customersCreate.mockResolvedValue({ id: "cus_brand_new" });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    // Customer created with org_id metadata so the webhook can match the
    // resulting checkout.session.completed (mode: setup) event back to the org
    // without a DB lookup by customer id.
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      name: "Test Org",
      metadata: { org_id: "org-1" },
    });

    // Customer id persisted to the org row before the checkout call so a
    // retried setup or a later subscription creation reuses the same customer.
    const orgUpdates = mocks.updates.organizations ?? [];
    const customerUpdate = orgUpdates.find(
      (u) =>
        (u as Record<string, unknown>).stripe_customer_id === "cus_brand_new",
    );
    expect(customerUpdate).toBeDefined();

    // Setup session is created against the brand-new customer id.
    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.customer).toBe("cus_brand_new");
  });

  it("reuses the existing stripe_customer_id without creating a new customer", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_existing_xyz",
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);

    expect(mocks.customersCreate).not.toHaveBeenCalled();
    // No organizations update should be issued when the customer already
    // exists — nothing to persist.
    expect(mocks.updates.organizations).toBeUndefined();

    const [sessionArgs] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.customer).toBe("cus_existing_xyz");
  });
});

// ── Setup session shape ───────────────────────────────────────────────────────

describe("POST /api/billing/create-setup — session shape", () => {
  it("creates a setup-mode session with org metadata and configured URLs", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club_large",
      subscription_status: "trialing",
      stripe_customer_id: "cus_existing",
    });

    await POST(makeRequest({ orgId: "org-1" }));

    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    const [args, opts] = mocks.checkoutSessionsCreate.mock.calls[0];

    expect(args.mode).toBe("setup");
    expect(args.customer).toBe("cus_existing");
    expect(args.metadata).toEqual({ org_id: "org-1" });

    // Stripe requires an explicit currency for setup-mode sessions.
    expect(args.currency).toBe("usd");

    // mode:'setup' must not include line_items / subscription_data — those are
    // for subscription-mode sessions and Stripe would reject the call.
    expect(args.line_items).toBeUndefined();
    expect(args.subscription_data).toBeUndefined();

    // The spec is explicit: no `customer_update` flag. The webhook is what
    // sets `invoice_settings.default_payment_method` on the customer.
    expect(args.customer_update).toBeUndefined();

    // Return URLs land back on the Club Billing page so the trial banner can
    // re-render the "payment method on file" state immediately.
    expect(args.success_url).toBe(
      "https://app.lista.test/dashboard/club/billing?setup=success",
    );
    expect(args.cancel_url).toBe(
      "https://app.lista.test/dashboard/club/billing?setup=canceled",
    );

    // Idempotency key is scoped to the org (no tier suffix — setup sessions
    // don't reference a price, so the tier is irrelevant). A double-click
    // within Stripe's 24h window returns the same session URL.
    expect(opts.idempotencyKey).toBe("setup-org-1");
  });

  it("produces the same idempotency key across both tiers", async () => {
    // A trialing org can be club_small or club_large; both call the same
    // tier-independent setup endpoint and must use the same idempotency
    // bucket so a retry on the same org doesn't spawn a new session for the
    // other tier (unlike checkout, which IS tier-keyed).
    seedOwner({
      id: "org-a",
      name: "Org A",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_a",
    });
    await POST(makeRequest({ orgId: "org-a" }));

    // Flip the same org to club_large WITHOUT resetting the spy, so both
    // calls accumulate and we can compare their idempotency keys.
    mocks.tableData.organizations = {
      id: "org-a",
      name: "Org A",
      plan: "club_large",
      subscription_status: "trialing",
      stripe_customer_id: "cus_a",
    };
    await POST(makeRequest({ orgId: "org-a" }));

    const keys = mocks.checkoutSessionsCreate.mock.calls.map(
      (c) => c[1].idempotencyKey,
    );
    expect(keys).toEqual(["setup-org-a", "setup-org-a"]);
  });

  it("uses different idempotency keys per org", async () => {
    seedOwner({
      id: "org-a",
      name: "Org A",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_a",
    });
    await POST(makeRequest({ orgId: "org-a" }));

    mocks.tableData.organizations = {
      id: "org-b",
      name: "Org B",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_b",
    };
    await POST(makeRequest({ orgId: "org-b" }));

    const keys = mocks.checkoutSessionsCreate.mock.calls.map(
      (c) => c[1].idempotencyKey,
    );
    expect(keys).toEqual(["setup-org-a", "setup-org-b"]);
  });

  it("returns the session URL to the caller", async () => {
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_existing",
    });
    mocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_setup_specific",
      url: "https://checkout.stripe.test/cs_setup_specific",
    });

    const res = await POST(makeRequest({ orgId: "org-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/cs_setup_specific",
    });
  });

  it("falls back to localhost return URLs when NEXT_PUBLIC_APP_URL is unset", async () => {
    vi.unstubAllEnvs();
    seedOwner({
      id: "org-1",
      name: "Test Org",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_customer_id: "cus_existing",
    });

    await POST(makeRequest({ orgId: "org-1" }));

    const [args] = mocks.checkoutSessionsCreate.mock.calls[0];
    expect(args.success_url).toBe(
      "http://localhost:3000/dashboard/club/billing?setup=success",
    );
    expect(args.cancel_url).toBe(
      "http://localhost:3000/dashboard/club/billing?setup=canceled",
    );
  });
});
