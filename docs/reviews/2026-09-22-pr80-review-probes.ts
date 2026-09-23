// PR #80 review at 21bcf1546. Seven assertions of desired behavior fail here.
// Uses the actual route and ledger helpers, with an in-memory database double
// adapted from tests/billing/webhook-delivery.test.ts. No real email or Stripe
// call is made, and no database state is changed.
// To run, copy this file to tests/billing/pr80-review-probes.test.ts, then:
// pnpm exec vitest run --config vitest.config.rls.mts tests/billing/pr80-review-probes.test.ts
// Remove the temporary test copy afterward.
/**
 * Delivery guarantees for POST /api/billing/webhook (BUG-015).
 *
 * The route used to await every Supabase write, discard the returned error, and
 * answer `{ received: true }`. Stripe records a successful delivery and stops
 * retrying, so a failed write became permanent: the club's plan stayed stale
 * with nothing left to correct it.
 *
 * The invariant these tests hold the route to is **not** "a failed write
 * returns 500". It is:
 *
 *   commit the processing, or durably accept responsibility for retrying it,
 *   before acknowledging.
 *
 * Today the route is synchronous and accepts no such responsibility, so the
 * only honest way to satisfy the invariant is to withhold the acknowledgement.
 * If durable ingestion ever lands, `acknowledgedWithoutCommitting` below is the
 * one place that has to change — not every test.
 *
 * Run via: pnpm test:integration, and in CI with the tenant/billing step.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const mockInvalidateTenantCache = vi.hoisted(() =>
  vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)
);
vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: mockInvalidateTenantCache,
}));

const mockConstructEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockReturnValue({
    webhooks: { constructEvent: mockConstructEvent },
    customers: { update: vi.fn().mockResolvedValue({}) }, subscriptions: { retrieve: vi.fn().mockResolvedValue({items:{data:[{price:{id:"price_large_review"}}]}}) }, setupIntents: { retrieve: vi.fn().mockResolvedValue({payment_method:"pm_review"}) },
  }),
}));

const mockEmails = vi.hoisted(() => ({
  cancelled: vi.fn().mockResolvedValue(undefined),
  succeeded: vi.fn().mockResolvedValue(undefined),
  failed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications/billing-emails", () => ({
  sendSubscriptionCancelledEmail: mockEmails.cancelled,
  sendPaymentSucceededEmail: mockEmails.succeeded,
  sendPaymentFailedEmail: mockEmails.failed,
}));

/**
 * A small in-memory stand-in for the two tables the route touches.
 *
 * It models what actually matters here: the ledger really de-duplicates by
 * event id, and an organizations update really applies its filters, so an
 * out-of-order write is rejected by the store rather than by an assertion.
 */
const db = vi.hoisted(() => ({
  ledger: new Map<string, { completed_at: string | null }>(),
  org: { stripe_event_at: null as string | null, plan: "club_small", subscription_status: "active" as string },
  failUpdates: false,
  updates: [] as Record<string, unknown>[],
}));

const mockFrom = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "stripe_webhook_events") {
      return {
        upsert: (row: { event_id: string }) => ({
          select: () => {
            const known = db.ledger.has(row.event_id);
            if (!known) db.ledger.set(row.event_id, { completed_at: null });
            // ignoreDuplicates: an existing row comes back as no rows claimed.
            return Promise.resolve({ data: known ? [] : [row], error: null });
          },
        }),
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: () =>
              Promise.resolve({ data: db.ledger.get(id) ?? null, error: null }),
          }),
        }),
        update: (patch: { completed_at: string }) => ({
          eq: (_c: string, id: string) => {
            const row = db.ledger.get(id);
            if (row) row.completed_at = patch.completed_at;
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }

    // organizations
    const applyUpdate = (patch: Record<string, unknown>, guard?: string) => {
      if (db.failUpdates) {
        return Promise.resolve({ data: null, error: { message: "constraint violation" } });
      }
      // The ordering guard, as the database would apply it.
      if (guard && db.org.stripe_event_at) {
        const at = /lt\."?([^",)]+)"?/.exec(guard)?.[1];
        if (at && db.org.stripe_event_at >= at) {
          return Promise.resolve({ data: null, error: null }); // no rows matched
        }
      }
      db.updates.push(patch);
      Object.assign(db.org, patch);
      return Promise.resolve({ data: null, error: null });
    };

    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { ...db.org, stripe_customer_id: "cus_review", subdomain: null, custom_domain: null }, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        const chain = {
          eq: () => chain,
          or: (expr: string) => applyUpdate(patch, expr),
          then: (resolve: (v: unknown) => unknown) => applyUpdate(patch).then(resolve),
        };
        return chain;
      },
    };
  })
);

vi.mock("@/lib/api-auth", () => ({
  adminClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import { POST } from "@/app/api/billing/webhook/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function request(): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig_test" },
  });
}

function paymentSucceeded(id: string, createdIso: string) {
  return {
    id,
    type: "invoice.payment_succeeded",
    created: Math.floor(Date.parse(createdIso) / 1000),
    data: {
      object: {
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_123" },
        },
      },
    },
  };
}

function paymentFailed(id: string, createdIso: string) {
  return { ...paymentSucceeded(id, createdIso), id, type: "invoice.payment_failed" };
}

/**
 * The invariant, in one place.
 *
 * A 2xx tells Stripe to stop retrying. That is only honest once the work is
 * committed, or once something durable has taken on the obligation to finish
 * it. The route does neither when a write fails, so a 2xx here would be a lie.
 */
function acknowledgedWithoutCommitting(status: number, committed: boolean) {
  return status < 300 && !committed;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.ledger.clear();
  db.org = { stripe_event_at: null, plan: "club_small", subscription_status: "active" };
  db.failUpdates = false;
  db.updates = [];
});

describe("PR80 review regressions", () => {
  it("does not acknowledge a failed terminal cancellation write", async () => {
    db.failUpdates = true;
    mockConstructEvent.mockReturnValue({
      id: "evt_delete_fail", created: 1790071200, type: "customer.subscription.deleted",
      data: { object: { id: "sub_123" } },
    });
    const response = await POST(request());
    expect(acknowledgedWithoutCommitting(response.status, db.updates.length > 0)).toBe(false);
    expect(db.ledger.get("evt_delete_fail")?.completed_at ?? null).toBeNull();
  });

  it("applies a distinct payment success generated in the same second", async () => {
    mockConstructEvent.mockReturnValue(paymentFailed("evt_failed", "2026-09-22T10:00:00.000Z"));
    await POST(request());
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_paid", "2026-09-22T10:00:00.000Z"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(db.org.subscription_status).toBe("active");
  });

  it("does not let a newer invoice discard a subscription's independent tier update", async () => {
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", "price_large_review");
    mockConstructEvent.mockReturnValue(paymentFailed("evt_invoice", "2026-09-22T12:00:00.000Z"));
    await POST(request());
    mockConstructEvent.mockReturnValue({
      id: "evt_tier", created: Math.floor(Date.parse("2026-09-22T11:00:00.000Z") / 1000),
      type: "customer.subscription.updated",
      data: { object: { id: "sub_123", cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_large_review" } }] } } },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(db.org.subscription_status).toBe("past_due");
    expect(db.org.plan).toBe("club_large");
  });

  it("does not reactivate a canceled subscription with an older paid invoice", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_deleted", created: Math.floor(Date.parse("2026-09-22T12:00:00.000Z") / 1000),
      type: "customer.subscription.deleted", data: { object: { id: "sub_123" } },
    });
    await POST(request());
    expect(db.org.subscription_status).toBe("canceled");
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_older_paid", "2026-09-22T11:00:00.000Z"));
    await POST(request());
    expect(db.org.subscription_status).toBe("canceled");
  });

  it("sends one email for overlapping deliveries of the same event", async () => {
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_concurrent", "2026-09-22T10:00:00.000Z"));
    await Promise.all([POST(request()), POST(request())]);
    expect(mockEmails.succeeded).toHaveBeenCalledTimes(1);
  });
});
for (const mode of ["subscription", "setup"]) {
  it(`does not acknowledge a failed checkout ${mode} write`, async () => {
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", "price_large_review");
    db.failUpdates = true;
    mockConstructEvent.mockReturnValue({
      id: `evt_checkout_${mode}`, created: 1790071200, type: "checkout.session.completed",
      data: { object: { mode, metadata: { org_id: "org_review" }, customer: "cus_review",
        subscription: "sub_123", setup_intent: "seti_review" } },
    });
    const response = await POST(request());
    expect(acknowledgedWithoutCommitting(response.status, db.updates.length > 0)).toBe(false);
  });
}

