/**
 * Unit tests for POST /api/billing/webhook.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Webhook Events" table
 * (checkout.session.completed branching on mode, customer.subscription.*,
 * subscription_schedule.released/canceled, invoice.payment_*) and "Trial
 * Expiration (Day 91 Cron)" — the customer.subscription.created no-op is
 * what prevents the cron's `subscriptions.create` from double-writing.
 *
 * Why every event matters:
 *   - `checkout.session.completed (mode: subscription)`: the price ID is the
 *     only place the tier is encoded after a paid upgrade; mapping it to
 *     plan + team_limit is the load-bearing write for the entire feature gate.
 *   - `checkout.session.completed (mode: setup)`: the cron reads
 *     `customer.invoice_settings.default_payment_method` to decide whether
 *     to convert vs downgrade — if the webhook fails to set it after the
 *     SetupIntent succeeds, every trialing org with an attached card gets
 *     downgraded by mistake.
 *   - `customer.subscription.created`: must NOT double-write — the cron
 *     immediately writes `stripe_subscription_id` after `subscriptions.create`
 *     and uses it as the idempotency skip-key on subsequent runs. A duplicate
 *     write here would race that guard.
 *   - `customer.subscription.updated`: this event fires for many reasons; the
 *     handler must branch correctly on cancel_at_period_end (pending cancel
 *     window — access stays active) and on price-ID change (schedule executed
 *     OR direct Small → Large via change-plan).
 *   - `customer.subscription.deleted`: terminal cancellation — writes the full
 *     downgrade payload AND quarantines the subdomain so it can't be claimed
 *     for 180 days.
 *   - `subscription_schedule.released`: phase executed normally — only clears
 *     stripe_schedule_id (plan/team_limit already written by the preceding
 *     customer.subscription.updated).
 *   - `subscription_schedule.canceled`: schedule cancelled before executing —
 *     clears all three pending-downgrade markers. Matched via
 *     metadata.org_id because customer.subscription.updated is too ambiguous
 *     to use as a schedule-cancellation signal.
 *
 * All Supabase and Stripe calls are mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Each update call records the table, the values written, and the .eq()
  // filters. The webhook uses different WHERE clauses for different events
  // (eq("id") for setup / schedule events, eq("stripe_subscription_id") for
  // sub.updated / sub.deleted), and several spec assertions hinge on the
  // correct filter being used.
  type UpdateCall = {
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ column: string; value: unknown }>;
  };
  const updateCalls: UpdateCall[] = [];
  const tableData: Record<string, unknown> = {};

  const makeSelectChain = (val: unknown): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const chain: Record<string, unknown> = {
      eq: () => makeSelectChain(val),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: () => makeSelectChain(tableData[table] ?? null),
    update: (values: Record<string, unknown>) => {
      const call: UpdateCall = { table, values, filters: [] };
      updateCalls.push(call);
      const eqChain: Record<string, unknown> = {
        eq: (column: string, value: unknown) => {
          call.filters.push({ column, value });
          // Returns a thenable so trailing-`.eq` await resolves.
          return {
            then: (
              res: (v: unknown) => unknown,
              rej?: (e: unknown) => unknown,
            ) =>
              Promise.resolve({ data: null, error: null }).then(res, rej),
            eq: eqChain.eq,
          };
        },
      };
      return eqChain;
    },
  }));

  const constructEvent = vi.fn();
  const subscriptionsRetrieve = vi.fn();
  const setupIntentsRetrieve = vi.fn();
  const customersUpdate = vi.fn();

  const invalidateTenantCache = vi.fn().mockResolvedValue(undefined);

  const sendPaymentSucceededEmail = vi.fn().mockResolvedValue(true);
  const sendPaymentFailedEmail = vi.fn().mockResolvedValue(true);
  const sendSubscriptionCancelledEmail = vi.fn().mockResolvedValue(true);

  return {
    updateCalls,
    tableData,
    mockFrom,
    constructEvent,
    subscriptionsRetrieve,
    setupIntentsRetrieve,
    customersUpdate,
    invalidateTenantCache,
    sendPaymentSucceededEmail,
    sendPaymentFailedEmail,
    sendSubscriptionCancelledEmail,
  };
});

vi.mock("@/lib/api-auth", () => ({
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.subscriptionsRetrieve },
    setupIntents: { retrieve: mocks.setupIntentsRetrieve },
    customers: { update: mocks.customersUpdate },
  }),
}));

vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: mocks.invalidateTenantCache,
}));

vi.mock("@/lib/notifications/billing-emails", () => ({
  sendPaymentSucceededEmail: mocks.sendPaymentSucceededEmail,
  sendPaymentFailedEmail: mocks.sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail: mocks.sendSubscriptionCancelledEmail,
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/billing/webhook/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SMALL_PRICE = "price_test_small_abc";
const LARGE_PRICE = "price_test_large_xyz";

function makeWebhookRequest(): Request {
  return new Request("http://localhost:3000/api/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "t=1,v1=sig",
    },
    body: "{}",
  });
}

function stubEvent(event: unknown) {
  mocks.constructEvent.mockReturnValueOnce(event);
}

function findUpdate(
  table: string,
  filter?: { column: string; value: unknown },
) {
  return mocks.updateCalls.find(
    (call) =>
      call.table === table &&
      (filter == null ||
        call.filters.some(
          (f) => f.column === filter.column && f.value === filter.value,
        )),
  );
}

function resetState() {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
  mocks.invalidateTenantCache.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetState();
  vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_PRICE);
  vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_PRICE);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Signature handling ───────────────────────────────────────────────────────

describe("POST /api/billing/webhook — signature", () => {
  it("returns 400 'missing_signature' when stripe-signature header is absent", async () => {
    const req = new Request("http://localhost:3000/api/billing/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_signature" });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 'invalid_signature' when constructEvent throws", async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error("bad sig");
    });
    const res = await POST(makeWebhookRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(mocks.updateCalls.length).toBe(0);
  });

  it("returns 200 on a valid event the webhook does not handle", async () => {
    stubEvent({ type: "customer.created", data: { object: {} } });
    const res = await POST(makeWebhookRequest());
    expect(res.status).toBe(200);
    expect(mocks.updateCalls.length).toBe(0);
  });
});

// ── checkout.session.completed (mode: subscription) ──────────────────────────

describe("POST /api/billing/webhook — checkout.session.completed (subscription)", () => {
  it("maps STRIPE_CLUB_SMALL_PRICE_ID → plan='club_small' + team_limit=10", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_match",
      subscription_status: null,
    };
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [{ price: { id: SMALL_PRICE } }] },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    const res = await POST(makeWebhookRequest());
    expect(res.status).toBe(200);

    const update = findUpdate("organizations", { column: "id", value: "org-1" });
    expect(update?.values).toMatchObject({
      plan: "club_small",
      team_limit: 10,
      stripe_subscription_id: "sub_new",
      subscription_status: "active",
    });
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_new");
  });

  it("maps STRIPE_CLUB_LARGE_PRICE_ID → plan='club_large' + team_limit=null", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_match",
      subscription_status: null,
    };
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [{ price: { id: LARGE_PRICE } }] },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", { column: "id", value: "org-1" });
    expect(update?.values.plan).toBe("club_large");
    expect(update?.values.team_limit).toBeNull();
  });

  it("restores a quarantined subdomain and busts the tenant cache on re-upgrade", async () => {
    mocks.tableData.organizations = {
      subdomain: "joga",
      subdomain_status: "quarantined",
      stripe_customer_id: "cus_match",
      subscription_status: null,
    };
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [{ price: { id: LARGE_PRICE } }] },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", { column: "id", value: "org-1" });
    expect(update?.values).toMatchObject({
      subdomain_status: "active",
      subdomain_quarantined_at: null,
    });
    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith("joga.lista.team");
  });

  it("leaves subdomain alone when the org has no subdomain", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_match",
      subscription_status: null,
    };
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [{ price: { id: SMALL_PRICE } }] },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", { column: "id", value: "org-1" });
    expect(update?.values).not.toHaveProperty("subdomain_status");
    expect(update?.values).not.toHaveProperty("subdomain_quarantined_at");
    expect(mocks.invalidateTenantCache).not.toHaveBeenCalled();
  });

  it("refuses to activate when the org's stored customer id doesn't match the session", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_other",
      subscription_status: null,
    };
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_mismatch",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("refuses to activate when the org is already in 'canceled' status", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_match",
      subscription_status: "canceled",
    };
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
  });

  it("ignores an unrecognised Stripe price id (defense-in-depth)", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      stripe_customer_id: "cus_match",
      subscription_status: null,
    };
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_new",
      items: { data: [{ price: { id: "price_legacy_unknown" } }] },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_match",
          subscription: "sub_new",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    // Subscription is retrieved (we have to read the price to decide), but no
    // organizations row is mutated.
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
    expect(mocks.updateCalls.length).toBe(0);
  });

  it("breaks early when session.metadata.org_id is missing", async () => {
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_x",
          subscription: "sub_x",
          metadata: {},
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
  });
});

// ── checkout.session.completed (mode: setup) ─────────────────────────────────

describe("POST /api/billing/webhook — checkout.session.completed (setup)", () => {
  it("retrieves the SetupIntent, sets the customer default PM, and persists stripe_customer_id", async () => {
    mocks.setupIntentsRetrieve.mockResolvedValueOnce({
      id: "seti_1",
      payment_method: "pm_card_visa",
    });
    mocks.customersUpdate.mockResolvedValueOnce({ id: "cus_setup" });

    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "setup",
          customer: "cus_setup",
          setup_intent: "seti_1",
          metadata: { org_id: "org-1" },
        },
      },
    });

    const res = await POST(makeWebhookRequest());
    expect(res.status).toBe(200);
    expect(mocks.setupIntentsRetrieve).toHaveBeenCalledWith("seti_1");
    expect(mocks.customersUpdate).toHaveBeenCalledWith("cus_setup", {
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    const update = findUpdate("organizations", { column: "id", value: "org-1" });
    expect(update?.values).toEqual({ stripe_customer_id: "cus_setup" });
  });

  it("handles an expanded payment_method object (uses .id)", async () => {
    mocks.setupIntentsRetrieve.mockResolvedValueOnce({
      id: "seti_2",
      payment_method: { id: "pm_card_amex" },
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "setup",
          customer: "cus_setup",
          setup_intent: "seti_2",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    expect(mocks.customersUpdate).toHaveBeenCalledWith("cus_setup", {
      invoice_settings: { default_payment_method: "pm_card_amex" },
    });
  });

  it("breaks without writes when SetupIntent has no payment_method", async () => {
    mocks.setupIntentsRetrieve.mockResolvedValueOnce({
      id: "seti_3",
      payment_method: null,
    });
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "setup",
          customer: "cus_setup",
          setup_intent: "seti_3",
          metadata: { org_id: "org-1" },
        },
      },
    });

    await POST(makeWebhookRequest());
    // No customer default written and no DB write — the cron will treat this
    // org as "no payment method" on day 91.
    expect(mocks.customersUpdate).not.toHaveBeenCalled();
    expect(mocks.updateCalls.length).toBe(0);
  });

  it("breaks without writes when session.customer or session.setup_intent is missing", async () => {
    stubEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "setup",
          customer: null,
          setup_intent: "seti_4",
          metadata: { org_id: "org-1" },
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.setupIntentsRetrieve).not.toHaveBeenCalled();
    expect(mocks.updateCalls.length).toBe(0);
  });
});

// ── customer.subscription.created (no-op) ────────────────────────────────────

describe("POST /api/billing/webhook — customer.subscription.created", () => {
  it("is a no-op (spec §Webhook Events) — no DB write, no Stripe lookup", async () => {
    stubEvent({
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_anything",
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });
    const res = await POST(makeWebhookRequest());
    expect(res.status).toBe(200);
    expect(mocks.updateCalls.length).toBe(0);
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.customersUpdate).not.toHaveBeenCalled();
  });
});

// ── customer.subscription.updated ───────────────────────────────────────────

describe("POST /api/billing/webhook — customer.subscription.updated", () => {
  it("writes subscription_cancel_at as ISO when cancel_at_period_end=true", async () => {
    const cancelAtUnix = 1_780_000_000;
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: true,
          cancel_at: cancelAtUnix,
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });

    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    expect(update?.values.subscription_cancel_at).toBe(
      new Date(cancelAtUnix * 1000).toISOString(),
    );
  });

  it("clears subscription_cancel_at when cancel_at_period_end=false (reactivation)", async () => {
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: false,
          cancel_at: null,
          items: { data: [{ price: { id: LARGE_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    expect(update?.values.subscription_cancel_at).toBeNull();
  });

  it("flips plan + team_limit + clears pending_* when price changes to club_small (schedule executed)", async () => {
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    expect(update?.values).toMatchObject({
      plan: "club_small",
      team_limit: 10,
      pending_plan: null,
      pending_plan_at: null,
    });
  });

  it("flips plan + team_limit but does NOT touch pending_* when price changes to club_large (direct upgrade)", async () => {
    // pending_plan is restricted by the DB CHECK to 'club_small', so an
    // upgrade to Large is never the result of a schedule firing. Touching
    // pending_* here would erase legitimate pending state on an unrelated row.
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: LARGE_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    expect(update?.values.plan).toBe("club_large");
    expect(update?.values.team_limit).toBeNull();
    expect(update?.values).not.toHaveProperty("pending_plan");
    expect(update?.values).not.toHaveProperty("pending_plan_at");
  });

  it("writes both subscription_cancel_at AND tier on a combined cancel-pending + tier change event", async () => {
    const cancelAtUnix = 1_780_000_500;
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: true,
          cancel_at: cancelAtUnix,
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    expect(update?.values).toMatchObject({
      subscription_cancel_at: new Date(cancelAtUnix * 1000).toISOString(),
      plan: "club_small",
      team_limit: 10,
      pending_plan: null,
      pending_plan_at: null,
    });
  });

  it("does not touch plan/team_limit when the price ID is not one of our tiers", async () => {
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_legacy_unknown" } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_existing",
    });
    // Only the cancel_at_period_end mirror is written.
    expect(update?.values).not.toHaveProperty("plan");
    expect(update?.values).not.toHaveProperty("team_limit");
    expect(update?.values).not.toHaveProperty("pending_plan");
    expect(update?.values).toMatchObject({ subscription_cancel_at: null });
  });

  it("filters the UPDATE by stripe_subscription_id (not by id) so a stale org row can't be hit", async () => {
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.updateCalls[0].filters).toEqual([
      { column: "stripe_subscription_id", value: "sub_existing" },
    ]);
  });
});

// ── customer.subscription.deleted ────────────────────────────────────────────

describe("POST /api/billing/webhook — customer.subscription.deleted", () => {
  it("writes full downgrade payload + quarantines subdomain + busts caches", async () => {
    mocks.tableData.organizations = {
      subdomain: "joga",
      subdomain_status: "active",
      custom_domain: "club.joga.com",
    };
    stubEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_dead" } },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_dead",
    });
    expect(update?.values).toMatchObject({
      plan: "free",
      team_limit: 1, // The new requirement vs the previous handler.
      subscription_status: "canceled",
      subscription_cancel_at: null,
      subdomain_status: "quarantined",
      custom_domain: null,
    });
    expect(update?.values.subdomain_quarantined_at).toEqual(
      expect.any(String),
    );

    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith(
      "joga.lista.team",
    );
    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith("club.joga.com");
  });

  it("clears subdomain_status to null and skips cache invalidation when no subdomain on file", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      custom_domain: null,
    };
    stubEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_no_subdomain" } },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_no_subdomain",
    });
    expect(update?.values).toMatchObject({
      plan: "free",
      team_limit: 1,
      subscription_status: "canceled",
      subscription_cancel_at: null,
      subdomain_status: null,
      subdomain_quarantined_at: null,
      custom_domain: null,
    });
    expect(mocks.invalidateTenantCache).not.toHaveBeenCalled();
  });
});

// ── subscription_schedule.* ──────────────────────────────────────────────────

describe("POST /api/billing/webhook — subscription_schedule.released", () => {
  it("clears stripe_schedule_id and matches by metadata.org_id", async () => {
    stubEvent({
      type: "subscription_schedule.released",
      data: {
        object: { id: "sub_sched_1", metadata: { org_id: "org-99" } },
      },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", { column: "id", value: "org-99" });
    expect(update?.values).toEqual({ stripe_schedule_id: null });
    // Critically, plan/team_limit are NOT cleared here — the preceding
    // customer.subscription.updated event already wrote them.
    expect(update?.values).not.toHaveProperty("plan");
    expect(update?.values).not.toHaveProperty("team_limit");
  });

  it("no-ops if metadata.org_id is absent (defensive — every schedule we create stamps it)", async () => {
    stubEvent({
      type: "subscription_schedule.released",
      data: { object: { id: "sub_sched_1", metadata: {} } },
    });
    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
  });
});

describe("POST /api/billing/webhook — subscription_schedule.canceled", () => {
  it("clears pending_plan, pending_plan_at, stripe_schedule_id (matched via metadata.org_id)", async () => {
    stubEvent({
      type: "subscription_schedule.canceled",
      data: {
        object: { id: "sub_sched_2", metadata: { org_id: "org-77" } },
      },
    });

    await POST(makeWebhookRequest());

    const update = findUpdate("organizations", { column: "id", value: "org-77" });
    expect(update?.values).toEqual({
      pending_plan: null,
      pending_plan_at: null,
      stripe_schedule_id: null,
    });
  });

  it("no-ops if metadata.org_id is absent", async () => {
    stubEvent({
      type: "subscription_schedule.canceled",
      data: { object: { id: "sub_sched_2", metadata: {} } },
    });
    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
  });
});

// ── invoice.payment_succeeded / payment_failed ───────────────────────────────

describe("POST /api/billing/webhook — invoice events", () => {
  it("invoice.payment_succeeded → subscription_status='active' keyed by stripe_subscription_id", async () => {
    stubEvent({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_paid" },
          },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_paid",
    });
    expect(update?.values).toEqual({ subscription_status: "active" });
  });

  it("invoice.payment_failed → subscription_status='past_due'", async () => {
    stubEvent({
      type: "invoice.payment_failed",
      data: {
        object: {
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_failed" },
          },
        },
      },
    });
    await POST(makeWebhookRequest());
    const update = findUpdate("organizations", {
      column: "stripe_subscription_id",
      value: "sub_failed",
    });
    expect(update?.values).toEqual({ subscription_status: "past_due" });
  });

  it("invoice events with no subscription parent are ignored", async () => {
    stubEvent({
      type: "invoice.payment_succeeded",
      data: { object: { parent: { type: "self" } } },
    });
    await POST(makeWebhookRequest());
    expect(mocks.updateCalls.length).toBe(0);
    // No subscription id means we can't resolve an org/owner — the email
    // helper must not be called.
    expect(mocks.sendPaymentSucceededEmail).not.toHaveBeenCalled();
    expect(mocks.sendPaymentFailedEmail).not.toHaveBeenCalled();
  });
});

// ── Email fan-out (spec: "Email Notifications" table) ────────────────────────
//
// Why every fan-out has its own test:
//  - The spec mandates a specific email per lifecycle event; missing a wire
//    here means a real customer never hears that their card was charged or
//    their subscription was cancelled.
//  - The fan-out must happen AFTER the DB update so the email's "Manage
//    billing" deep-link lands on the post-state page (otherwise the page
//    shows a stale badge).
//  - The fan-out must use the SAME subscription id as the DB write so the
//    helper resolves the right org owner (subscription id is the only join
//    key available in invoice events).

describe("POST /api/billing/webhook — email fan-out", () => {
  it("fires sendPaymentSucceededEmail with the subscription id after invoice.payment_succeeded", async () => {
    stubEvent({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_paid" },
          },
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.sendPaymentSucceededEmail).toHaveBeenCalledTimes(1);
    // Args = (admin, subscriptionId)
    expect(mocks.sendPaymentSucceededEmail.mock.calls[0][1]).toBe("sub_paid");
  });

  it("fires sendPaymentFailedEmail with the subscription id after invoice.payment_failed", async () => {
    stubEvent({
      type: "invoice.payment_failed",
      data: {
        object: {
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_failed" },
          },
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.sendPaymentFailedEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendPaymentFailedEmail.mock.calls[0][1]).toBe("sub_failed");
  });

  it("fires sendSubscriptionCancelledEmail with the subscription id after customer.subscription.deleted", async () => {
    mocks.tableData.organizations = {
      subdomain: null,
      subdomain_status: null,
      custom_domain: null,
    };
    stubEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_dead" } },
    });
    await POST(makeWebhookRequest());
    expect(mocks.sendSubscriptionCancelledEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendSubscriptionCancelledEmail.mock.calls[0][1]).toBe(
      "sub_dead",
    );
  });

  it("does NOT send a payment-succeeded email when the invoice has no subscription parent", async () => {
    stubEvent({
      type: "invoice.payment_succeeded",
      data: { object: { parent: { type: "self" } } },
    });
    await POST(makeWebhookRequest());
    expect(mocks.sendPaymentSucceededEmail).not.toHaveBeenCalled();
  });

  it("does NOT fire payment / cancellation emails for unrelated event types", async () => {
    // customer.subscription.updated handles cancel-at-period-end → DB write
    // mirrors subscription_cancel_at, but no email is sent at that point. The
    // cancellation email only fires on `customer.subscription.deleted` (final).
    stubEvent({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_existing",
          cancel_at_period_end: true,
          cancel_at: 1_780_000_000,
          items: { data: [{ price: { id: SMALL_PRICE } }] },
        },
      },
    });
    await POST(makeWebhookRequest());
    expect(mocks.sendPaymentSucceededEmail).not.toHaveBeenCalled();
    expect(mocks.sendPaymentFailedEmail).not.toHaveBeenCalled();
    expect(mocks.sendSubscriptionCancelledEmail).not.toHaveBeenCalled();
  });
});
