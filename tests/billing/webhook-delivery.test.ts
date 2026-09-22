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
    customers: { update: vi.fn().mockResolvedValue({}) },
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
          maybeSingle: () => Promise.resolve({ data: { subdomain: null, custom_domain: null }, error: null }),
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

// ── The four regressions the ticket names ─────────────────────────────────────

describe("a write that fails", () => {
  it("is not acknowledged as done", async () => {
    db.failUpdates = true;
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_1", "2026-09-22T10:00:00.000Z"));

    const response = await POST(request());
    const committed = db.updates.length > 0;

    expect(acknowledgedWithoutCommitting(response.status, committed)).toBe(false);
    // And nothing records it as finished, so the retry will do it again.
    expect(db.ledger.get("evt_1")?.completed_at ?? null).toBeNull();
  });

  it("is retried successfully when Stripe delivers it again", async () => {
    db.failUpdates = true;
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_1", "2026-09-22T10:00:00.000Z"));
    await POST(request());

    // Stripe retries the same event id; this time the database is healthy.
    db.failUpdates = false;
    const retry = await POST(request());

    expect(retry.status).toBeLessThan(300);
    expect(db.org.subscription_status).toBe("active");
    expect(db.ledger.get("evt_1")?.completed_at).not.toBeNull();
  });
});

describe("the same event delivered twice", () => {
  it("has one effect", async () => {
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_dup", "2026-09-22T10:00:00.000Z"));

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    expect(db.updates).toHaveLength(1);
    // Side effects are inside the same guard: the owner is emailed once.
    expect(mockEmails.succeeded).toHaveBeenCalledTimes(1);
  });
});

describe("two subscription events delivered out of order", () => {
  it("leaves the newer state in place", async () => {
    // The newer event — a failed payment — arrives first.
    mockConstructEvent.mockReturnValue(paymentFailed("evt_new", "2026-09-22T12:00:00.000Z"));
    await POST(request());
    expect(db.org.subscription_status).toBe("past_due");

    // The older one follows. Stripe does not guarantee ordering.
    mockConstructEvent.mockReturnValue(paymentSucceeded("evt_old", "2026-09-22T10:00:00.000Z"));
    const response = await POST(request());

    // Accepted — there is nothing to retry — but it must not resurrect a state
    // the club has already moved on from.
    expect(response.status).toBeLessThan(300);
    expect(db.org.subscription_status).toBe("past_due");
  });
});

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
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(db.ledger.size).toBe(0);
    expect(db.updates).toHaveLength(0);
  });
});
