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
 * Ordering is not tested as ordering. The route reads subscription state back
 * from Stripe instead of sequencing event snapshots, so these tests set what
 * Stripe *currently* says and assert the route agrees with it.
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

const stripe = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieve: vi.fn(),
  setupIntentsRetrieve: vi.fn(),
  customersUpdate: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockReturnValue({
    webhooks: { constructEvent: stripe.constructEvent },
    subscriptions: { retrieve: stripe.retrieve },
    setupIntents: { retrieve: stripe.setupIntentsRetrieve },
    customers: { update: stripe.customersUpdate },
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
 * An in-memory stand-in for the two tables the route touches.
 *
 * It applies the ledger's filters rather than assuming them, so the exclusive
 * claim is exercised here and not merely asserted: a second delivery really is
 * refused the row while the first holds it.
 */
type LedgerRow = { completed_at: string | null; claimed_at: string | null };

const db = vi.hoisted(() => ({
  ledger: new Map<string, { completed_at: string | null; claimed_at: string | null }>(),
  org: {} as Record<string, unknown>,
  failUpdates: false,
  failTable: null as string | null,
  updates: [] as Record<string, unknown>[],
}));

const mockFrom = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "stripe_webhook_events") {
      return {
        upsert: (row: { event_id: string; claimed_at: string }) => ({
          select: () => {
            const known = db.ledger.has(row.event_id);
            if (!known) {
              db.ledger.set(row.event_id, { completed_at: null, claimed_at: row.claimed_at });
            }
            return Promise.resolve({ data: known ? [] : [row], error: null });
          },
        }),
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: () => Promise.resolve({ data: db.ledger.get(id) ?? null, error: null }),
          }),
        }),
        update: (patch: Partial<LedgerRow>) => {
          let id = "";
          let requireIncomplete = false;
          let lease: string | null = null;

          // Conditional take: every filter the ledger sends is applied here, so
          // the exclusive claim is exercised rather than assumed.
          const takeIfAllowed = () => {
            const row = db.ledger.get(id);
            const allowed =
              row &&
              (!requireIncomplete || row.completed_at === null) &&
              (lease === null || row.claimed_at === null || row.claimed_at < lease);
            if (allowed && row) Object.assign(row, patch);
            return Promise.resolve({ data: allowed ? [{ event_id: id }] : [], error: null });
          };

          const chain: Record<string, unknown> = {
            eq: (_c: string, value: string) => {
              id = value;
              return chain;
            },
            is: () => {
              requireIncomplete = true;
              return chain;
            },
            or: (expression: string) => {
              lease = /lt\."?([^",)]+)"?/.exec(expression)?.[1] ?? "";
              return chain;
            },
            select: () => takeIfAllowed(),
            // No select: the unconditional completion write.
            then: (resolve: (v: unknown) => unknown) => {
              const row = db.ledger.get(id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    }

    // organizations
    const failing = db.failUpdates && (db.failTable === null || db.failTable === table);
    const result = failing
      ? { data: null, error: { message: "constraint violation" } }
      : { data: null, error: null };

    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              failing
                ? { data: null, error: { message: "read failed" } }
                : {
                    data: { ...db.org, stripe_customer_id: "cus_1", subdomain: null, custom_domain: null },
                    error: null,
                  }
            ),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        const apply = () => {
          if (!failing) {
            db.updates.push(patch);
            Object.assign(db.org, patch);
          }
          return Promise.resolve(result);
        };
        const chain = {
          eq: () => chain,
          then: (resolve: (v: unknown) => unknown) => apply().then(resolve),
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

function invoiceEvent(id: string, type: string, createdIso: string) {
  return {
    id,
    type,
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

const paymentSucceeded = (id: string, at: string) =>
  invoiceEvent(id, "invoice.payment_succeeded", at);
const paymentFailed = (id: string, at: string) => invoiceEvent(id, "invoice.payment_failed", at);

/** What Stripe currently says about the subscription. */
function stripeSays(status: string) {
  stripe.retrieve.mockResolvedValue({
    id: "sub_123",
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [] },
  });
}

/**
 * The invariant, in one place.
 *
 * A 2xx tells Stripe to stop retrying. That is only honest once the work is
 * committed, or once something durable has taken on the obligation to finish
 * it. The route does neither when a write fails, so a 2xx would be a lie.
 */
function acknowledgedWithoutCommitting(status: number, committed: boolean) {
  return status < 300 && !committed;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", "price_large_test");
  db.ledger.clear();
  db.org = { plan: "club_small", subscription_status: "active" };
  db.failUpdates = false;
  db.failTable = null;
  db.updates = [];
  stripeSays("active");
  stripe.setupIntentsRetrieve.mockResolvedValue({ payment_method: "pm_1" });
  stripe.customersUpdate.mockResolvedValue({});
});

// ── Acknowledgement ───────────────────────────────────────────────────────────

describe("a write that fails", () => {
  const cases = [
    {
      name: "an invoice status write",
      event: () => paymentSucceeded("evt_invoice", "2026-09-22T10:00:00.000Z"),
    },
    {
      name: "the terminal cancellation write",
      event: () => ({
        id: "evt_cancel",
        type: "customer.subscription.deleted",
        created: Math.floor(Date.parse("2026-09-22T10:00:00.000Z") / 1000),
        data: { object: { id: "sub_123" } },
      }),
    },
    {
      name: "the checkout activation write",
      event: () => ({
        id: "evt_checkout",
        type: "checkout.session.completed",
        created: Math.floor(Date.parse("2026-09-22T10:00:00.000Z") / 1000),
        data: {
          object: {
            mode: "subscription",
            subscription: "sub_123",
            customer: "cus_1",
            metadata: { org_id: "org_1" },
          },
        },
      }),
    },
    {
      name: "the checkout setup write",
      event: () => ({
        id: "evt_setup",
        type: "checkout.session.completed",
        created: Math.floor(Date.parse("2026-09-22T10:00:00.000Z") / 1000),
        data: {
          object: {
            mode: "setup",
            setup_intent: "seti_1",
            customer: "cus_1",
            metadata: { org_id: "org_1" },
          },
        },
      }),
    },
  ];

  it.each(cases)("is not acknowledged as done: $name", async ({ event }) => {
    db.failUpdates = true;
    stripe.constructEvent.mockReturnValue(event());

    const response = await POST(request());
    const committed = db.updates.length > 0;

    expect(acknowledgedWithoutCommitting(response.status, committed)).toBe(false);
    // Nothing records it as finished, so the retry will do it again.
    expect(db.ledger.get(event().id)?.completed_at ?? null).toBeNull();
  });

  it("is retried successfully when Stripe delivers it again", async () => {
    db.failUpdates = true;
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_1", "2026-09-22T10:00:00.000Z"));
    await POST(request());

    db.failUpdates = false;
    const retry = await POST(request());

    expect(retry.status).toBeLessThan(300);
    expect(db.org.subscription_status).toBe("active");
    expect(db.ledger.get("evt_1")?.completed_at).not.toBeNull();
  });
});

// ── Duplicate delivery ────────────────────────────────────────────────────────

describe("the same event delivered twice", () => {
  it("has one effect, one after the other", async () => {
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_dup", "2026-09-22T10:00:00.000Z"));

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    expect(db.updates).toHaveLength(1);
    expect(mockEmails.succeeded).toHaveBeenCalledTimes(1);
  });

  it("has one effect when both deliveries overlap", async () => {
    stripe.constructEvent.mockReturnValue(
      paymentSucceeded("evt_concurrent", "2026-09-22T10:00:00.000Z")
    );

    // Neither has finished when the other begins. Without an exclusive claim
    // both see an unfinished ledger row and both email the owner.
    await Promise.all([POST(request()), POST(request())]);

    expect(mockEmails.succeeded).toHaveBeenCalledTimes(1);
  });

  it("does not make a failed delivery wait out its own claim", async () => {
    db.failUpdates = true;
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_fail", "2026-09-22T10:00:00.000Z"));

    const failed = await POST(request());
    expect(failed.status).toBe(500);
    // The claim is given back rather than held: a delivery that knows it failed
    // should not answer 409 to its own retry for the length of the lease.
    expect(db.ledger.get("evt_fail")?.claimed_at).toBeNull();

    db.failUpdates = false;
    const retry = await POST(request());
    expect(retry.status).toBeLessThan(300);
  });

  it("is picked up again when the delivery that claimed it died", async () => {
    const { claimStripeEvent } = await import("@/lib/billing/webhook-ledger");
    const admin = { from: mockFrom } as never;
    const event = { id: "evt_abandoned", type: "invoice.payment_succeeded" };
    const at = "2026-09-22T10:00:00.000Z";

    expect(await claimStripeEvent(admin, event, at, new Date("2026-09-22T10:00:00Z"))).toBe(
      "process"
    );
    // A second delivery a moment later must not barge in…
    expect(await claimStripeEvent(admin, event, at, new Date("2026-09-22T10:00:30Z"))).toBe("busy");
    // …but one long after the lease expired has to, or the event is stuck.
    expect(await claimStripeEvent(admin, event, at, new Date("2026-09-22T10:30:00Z"))).toBe(
      "process"
    );
  });
});

// ── Ordering, avoided rather than solved ──────────────────────────────────────

describe("events that arrive in the wrong order", () => {
  it("writes what Stripe currently says, not what the older event said", async () => {
    // The newer event, a failed payment, arrives first.
    stripeSays("past_due");
    stripe.constructEvent.mockReturnValue(paymentFailed("evt_new", "2026-09-22T12:00:00.000Z"));
    await POST(request());
    expect(db.org.subscription_status).toBe("past_due");

    // The older one follows. Stripe still says past_due, so that is what the
    // route writes — no timestamp comparison involved.
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_old", "2026-09-22T10:00:00.000Z"));
    const response = await POST(request());

    expect(response.status).toBeLessThan(300);
    expect(db.org.subscription_status).toBe("past_due");
  });

  it("applies a distinct event that shares a second with another", async () => {
    // Stripe warns that two distinct events can carry the same timestamp, so a
    // strict comparison on it silently drops the second one.
    stripeSays("past_due");
    stripe.constructEvent.mockReturnValue(paymentFailed("evt_a", "2026-09-22T10:00:00.000Z"));
    await POST(request());

    stripeSays("active");
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_b", "2026-09-22T10:00:00.000Z"));
    await POST(request());

    expect(db.org.subscription_status).toBe("active");
  });

  it("does not let an invoice event discard an independent tier change", async () => {
    // The first attempt at this used one watermark per organization, so a
    // status-only write from an invoice advanced the same clock and then
    // discarded an older subscription event carrying a tier the invoice never
    // supplied. There is no shared clock now, so there is nothing to discard.
    stripeSays("past_due");
    stripe.constructEvent.mockReturnValue(paymentFailed("evt_invoice", "2026-09-22T12:00:00.000Z"));
    await POST(request());
    expect(db.org.subscription_status).toBe("past_due");

    // A delayed tier change from earlier still applies: it carries information
    // the invoice event never had.
    stripe.constructEvent.mockReturnValue({
      id: "evt_tier",
      type: "customer.subscription.updated",
      created: Math.floor(Date.parse("2026-09-22T11:00:00.000Z") / 1000),
      data: {
        object: {
          id: "sub_123",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: process.env.STRIPE_CLUB_LARGE_PRICE_ID } }] },
        },
      },
    });
    await POST(request());

    expect(db.org.plan).toBe("club_large");
    // And the status the invoice established is untouched by the tier write.
    expect(db.org.subscription_status).toBe("past_due");
  });

  it("does not revive a cancelled subscription with a late paid invoice", async () => {
    stripe.constructEvent.mockReturnValue({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      created: Math.floor(Date.parse("2026-09-22T12:00:00.000Z") / 1000),
      data: { object: { id: "sub_123" } },
    });
    await POST(request());
    expect(db.org.subscription_status).toBe("canceled");
    expect(db.org.plan).toBe("free");

    // A paid invoice from before the cancellation turns up late. Stripe reports
    // the subscription as cancelled by now, which is what gets written.
    stripeSays("canceled");
    stripe.constructEvent.mockReturnValue(paymentSucceeded("evt_late", "2026-09-22T11:00:00.000Z"));
    await POST(request());

    expect(db.org.subscription_status).toBe("canceled");
    expect(db.org.plan).toBe("free");
  });
});

// ── Signature ─────────────────────────────────────────────────────────────────

describe("signature verification", () => {
  it("still rejects a request with no signature", async () => {
    const unsigned = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });

    const response = await POST(unsigned);

    expect(response.status).toBe(400);
    expect(db.ledger.size).toBe(0);
  });

  it("still rejects a wrongly-signed request", async () => {
    stripe.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(db.ledger.size).toBe(0);
    expect(db.updates).toHaveLength(0);
  });
});
