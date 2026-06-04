/**
 * Unit tests for the daily trial-expiration cron (GET/POST /api/cron/trial-expiration).
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "During Trial" (reminder
 * schedule + idempotency) and "Trial Expiration (Day 91 Cron)" (conversion /
 * downgrade matrix).
 *
 * Why each branch matters:
 *   - CRON_SECRET: the cron mutates billing state; an unauthenticated call must
 *     not even touch Stripe or Resend.
 *   - Reminders 30/7/1d: each reminder writes a distinct sent-at column AFTER
 *     a successful send. The window query is ±1 day to survive a missed cron
 *     run; the sent-at column prevents a duplicate send on the next run while
 *     the org is still in the window.
 *   - Adopt-existing-active branch: closes the "Stripe sub created but DB write
 *     failed" loop. Without it the org would stay stuck in `trialing` forever
 *     (past the 24h idempotency window the Stripe key wouldn't help).
 *   - subscriptions.create idempotency key `trial-convert-{orgId}`: prevents
 *     double-billing if the cron runs twice within 24h before the webhook
 *     arrives. Pinned explicitly because Stripe silently drops a missing key.
 *   - default_payment_method passed explicitly: the cron is the first place a
 *     subscription is created with that payment method; relying on the customer
 *     default alone would bind the charge to a value that may change later.
 *   - Downgrade path: writes plan='free', team_limit=1, subscription_status=NULL
 *     and leaves trial_ends_at intact (permanent "trial consumed" gate).
 *   - Idempotency guard at query time: skip orgs with non-null
 *     stripe_subscription_id even if their subscription_status is still
 *     'trialing' (webhook delay).
 *
 * All Supabase, Stripe, and email calls are mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Capture every update: which table, the payload, and the .eq() filters so
  // tests can pin the WHERE clause as well as the values.
  type UpdateCall = {
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ column: string; value: unknown }>;
  };
  const updateCalls: UpdateCall[] = [];

  // Per-table FIFO queue of select results. Each .from(table).select(...) call
  // shifts the head of the queue (so multiple selects on the same table can
  // return distinct shapes per call). When the queue is empty, returns null.
  const selectQueues: Record<string, unknown[]> = {};

  // Capture each select call's table + the resolved filters so a test can
  // assert what was queried (e.g. the windowed reminder ranges).
  type SelectCall = {
    table: string;
    columns: string;
    filters: Array<{ op: string; column: string; value?: unknown }>;
  };
  const selectCalls: SelectCall[] = [];

  const makeSelectChain = (
    val: unknown,
    call: SelectCall,
  ): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const record =
      (op: string) =>
      (column: string, value?: unknown): Record<string, unknown> => {
        call.filters.push({ op, column, value });
        return chain;
      };
    const chain: Record<string, unknown> = {
      eq: record("eq"),
      gte: record("gte"),
      lte: record("lte"),
      lt: record("lt"),
      in: record("in"),
      is: record("is"),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  // Per-table update behavior. By default returns success.
  const updateErrors: Record<string, unknown> = {};

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: (columns: string) => {
      const call: SelectCall = { table, columns, filters: [] };
      selectCalls.push(call);
      const queue = selectQueues[table];
      const val =
        queue && queue.length > 0 ? queue.shift() : null;
      return makeSelectChain(val ?? null, call);
    },
    update: (values: Record<string, unknown>) => {
      const call: UpdateCall = { table, values, filters: [] };
      updateCalls.push(call);
      const eqChain: Record<string, unknown> = {
        eq: (column: string, value: unknown) => {
          call.filters.push({ column, value });
          return {
            then: (
              res: (v: unknown) => unknown,
              rej?: (e: unknown) => unknown,
            ) =>
              Promise.resolve({
                data: null,
                error: updateErrors[table] ?? null,
              }).then(res, rej),
            eq: eqChain.eq,
          };
        },
      };
      return eqChain;
    },
  }));

  const customersRetrieve = vi.fn();
  const subscriptionsList = vi.fn();
  const subscriptionsCreate = vi.fn();
  const sendTrialReminderEmail = vi.fn();
  const sendTrialConvertedEmail = vi.fn();
  const sendTrialDowngradedEmail = vi.fn();

  return {
    updateCalls,
    selectCalls,
    selectQueues,
    updateErrors,
    mockFrom,
    customersRetrieve,
    subscriptionsList,
    subscriptionsCreate,
    sendTrialReminderEmail,
    sendTrialConvertedEmail,
    sendTrialDowngradedEmail,
  };
});

vi.mock("@/lib/api-auth", () => ({
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: { retrieve: mocks.customersRetrieve },
    subscriptions: {
      list: mocks.subscriptionsList,
      create: mocks.subscriptionsCreate,
    },
  }),
}));

vi.mock("@/lib/notifications/billing-emails", () => ({
  sendTrialReminderEmail: mocks.sendTrialReminderEmail,
  sendTrialConvertedEmail: mocks.sendTrialConvertedEmail,
  sendTrialDowngradedEmail: mocks.sendTrialDowngradedEmail,
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { GET, POST } from "@/app/api/cron/trial-expiration/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SMALL_PRICE = "price_test_small";
const LARGE_PRICE = "price_test_large";
const CRON_SECRET = "test_cron_secret";
const NOW = new Date("2026-05-20T12:00:00Z");

function makeRequest(opts: { secret?: string; method?: "GET" | "POST" } = {}) {
  const headers = new Headers();
  if (opts.secret !== undefined) {
    headers.set("authorization", `Bearer ${opts.secret}`);
  }
  return new Request("http://localhost:3000/api/cron/trial-expiration", {
    method: opts.method ?? "POST",
    headers,
  });
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
  mocks.selectCalls.length = 0;
  Object.keys(mocks.selectQueues).forEach((k) => delete mocks.selectQueues[k]);
  Object.keys(mocks.updateErrors).forEach(
    (k) => delete mocks.updateErrors[k],
  );

  // Default happy-path: every reminder query returns no orgs, expiration query
  // returns no orgs, Stripe and email are unused unless a test seeds them.
  mocks.selectQueues.organizations = [];
  mocks.selectQueues.organization_members = [];
  mocks.sendTrialReminderEmail.mockResolvedValue(undefined);
  mocks.sendTrialConvertedEmail.mockResolvedValue(true);
  mocks.sendTrialDowngradedEmail.mockResolvedValue(true);
}

beforeEach(() => {
  resetState();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_PRICE);
  vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_PRICE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("trial-expiration cron — authentication", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No external side effects on auth failure.
    expect(mocks.mockFrom).not.toHaveBeenCalled();
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(mocks.sendTrialReminderEmail).not.toHaveBeenCalled();
    expect(mocks.sendTrialConvertedEmail).not.toHaveBeenCalled();
    expect(mocks.sendTrialDowngradedEmail).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong Bearer secret", async () => {
    const res = await POST(makeRequest({ secret: "wrong" }));
    expect(res.status).toBe(401);
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
  });

  it("accepts a valid Bearer secret and runs (200 with empty stats)", async () => {
    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reminders).toEqual({ d30: 0, d7: 0, d1: 0 });
    expect(body.expirations).toMatchObject({
      converted: 0,
      downgraded: 0,
      adopted: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("supports GET as well as POST (Vercel cron uses GET by default)", async () => {
    const res = await GET(makeRequest({ secret: CRON_SECRET, method: "GET" }));
    expect(res.status).toBe(200);
  });
});

// ── Reminders ────────────────────────────────────────────────────────────────

describe("trial-expiration cron — reminders", () => {
  it("queries each reminder window with the correct date range and IS NULL guard", async () => {
    // All three reminder queues empty — we just want to assert the query shape.
    mocks.selectQueues.organizations = [[], [], [], []];

    await POST(makeRequest({ secret: CRON_SECRET }));

    // The route runs 3 reminder windows then the expiration query, all against
    // the organizations table.
    const orgSelects = mocks.selectCalls.filter(
      (c) => c.table === "organizations",
    );
    expect(orgSelects).toHaveLength(4);

    // Reminder 30d: trial_ends_at BETWEEN now+29d AND now+31d AND
    //   trial_reminder_30d_sent_at IS NULL.
    const d30Filters = orgSelects[0].filters;
    expect(d30Filters).toContainEqual({
      op: "eq",
      column: "subscription_status",
      value: "trialing",
    });
    expect(
      d30Filters.find(
        (f) => f.op === "gte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 29 * 86_400_000).toISOString());
    expect(
      d30Filters.find(
        (f) => f.op === "lte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 31 * 86_400_000).toISOString());
    expect(d30Filters).toContainEqual({
      op: "is",
      column: "trial_reminder_30d_sent_at",
      value: null,
    });

    // Reminder 7d window.
    const d7Filters = orgSelects[1].filters;
    expect(
      d7Filters.find(
        (f) => f.op === "gte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 6 * 86_400_000).toISOString());
    expect(
      d7Filters.find(
        (f) => f.op === "lte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 8 * 86_400_000).toISOString());
    expect(d7Filters).toContainEqual({
      op: "is",
      column: "trial_reminder_7d_sent_at",
      value: null,
    });

    // Reminder 1d window.
    const d1Filters = orgSelects[2].filters;
    expect(
      d1Filters.find(
        (f) => f.op === "gte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 0 * 86_400_000).toISOString());
    expect(
      d1Filters.find(
        (f) => f.op === "lte" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(new Date(NOW.getTime() + 2 * 86_400_000).toISOString());
    expect(d1Filters).toContainEqual({
      op: "is",
      column: "trial_reminder_1d_sent_at",
      value: null,
    });
  });

  it("sends a 30-day reminder with the spec subject and writes trial_reminder_30d_sent_at", async () => {
    const trialEndsAt = new Date(
      NOW.getTime() + 30 * 86_400_000,
    ).toISOString();
    mocks.selectQueues.organizations = [
      [{ id: "org-1", name: "Acme FC", trial_ends_at: trialEndsAt }],
      [],
      [],
      [],
    ];
    mocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    // Email send with the spec's exact 30-day subject.
    expect(mocks.sendTrialReminderEmail).toHaveBeenCalledTimes(1);
    const sendArgs = mocks.sendTrialReminderEmail.mock.calls[0][0];
    expect(sendArgs.to).toBe("owner@acme.test");
    expect(sendArgs.subject).toBe("30 days left in your Lista Club trial");
    expect(sendArgs.orgName).toBe("Acme FC");

    // Sent-at column written ONLY after a successful send, and only this one
    // (not the 7d or 1d columns).
    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values.trial_reminder_30d_sent_at).toBe(NOW.toISOString());
    expect(update?.values).not.toHaveProperty("trial_reminder_7d_sent_at");
    expect(update?.values).not.toHaveProperty("trial_reminder_1d_sent_at");

    const body = await res.json();
    expect(body.reminders.d30).toBe(1);
  });

  it("sends a 7-day reminder with the correct subject and sent-at column", async () => {
    mocks.selectQueues.organizations = [
      [],
      [
        {
          id: "org-2",
          name: "Beta FC",
          trial_ends_at: new Date(
            NOW.getTime() + 7 * 86_400_000,
          ).toISOString(),
        },
      ],
      [],
      [],
    ];
    mocks.selectQueues.organization_members = [
      { profiles: { email: "owner@beta.test" } },
    ];

    await POST(makeRequest({ secret: CRON_SECRET }));

    const sendArgs = mocks.sendTrialReminderEmail.mock.calls[0][0];
    expect(sendArgs.subject).toBe(
      "7 days left — add a payment method to keep your club",
    );
    const update = findUpdate("organizations", {
      column: "id",
      value: "org-2",
    });
    expect(update?.values.trial_reminder_7d_sent_at).toBe(NOW.toISOString());
  });

  it("sends a 1-day reminder with the correct subject and sent-at column", async () => {
    mocks.selectQueues.organizations = [
      [],
      [],
      [
        {
          id: "org-3",
          name: "Gamma FC",
          trial_ends_at: new Date(
            NOW.getTime() + 1 * 86_400_000,
          ).toISOString(),
        },
      ],
      [],
    ];
    mocks.selectQueues.organization_members = [
      { profiles: { email: "owner@gamma.test" } },
    ];

    await POST(makeRequest({ secret: CRON_SECRET }));

    const sendArgs = mocks.sendTrialReminderEmail.mock.calls[0][0];
    expect(sendArgs.subject).toBe("Your trial ends tomorrow");
    const update = findUpdate("organizations", {
      column: "id",
      value: "org-3",
    });
    expect(update?.values.trial_reminder_1d_sent_at).toBe(NOW.toISOString());
  });

  it("does NOT write the sent-at column when sendEmail throws (failure leaves the row eligible to retry)", async () => {
    mocks.selectQueues.organizations = [
      [
        {
          id: "org-fail",
          name: "Fail Co",
          trial_ends_at: new Date(
            NOW.getTime() + 30 * 86_400_000,
          ).toISOString(),
        },
      ],
      [],
      [],
      [],
    ];
    mocks.selectQueues.organization_members = [
      { profiles: { email: "owner@fail.test" } },
    ];
    mocks.sendTrialReminderEmail.mockRejectedValueOnce(new Error("Resend down"));

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    // No organizations update for this org — the sent-at column stays NULL so
    // the next cron run can retry. This is the load-bearing invariant.
    expect(findUpdate("organizations", { column: "id", value: "org-fail" }))
      .toBeUndefined();
    const body = await res.json();
    expect(body.reminders.d30).toBe(0);
  });

  it("skips an org with no owner email (defensive — would be an org with no owner row)", async () => {
    mocks.selectQueues.organizations = [
      [
        {
          id: "org-no-owner",
          name: "No Owner",
          trial_ends_at: new Date(
            NOW.getTime() + 30 * 86_400_000,
          ).toISOString(),
        },
      ],
      [],
      [],
      [],
    ];
    mocks.selectQueues.organization_members = [null];

    await POST(makeRequest({ secret: CRON_SECRET }));
    expect(mocks.sendTrialReminderEmail).not.toHaveBeenCalled();
    expect(findUpdate("organizations", { column: "id", value: "org-no-owner" }))
      .toBeUndefined();
  });

  it("does not include the owner email lookup or send for orgs missing from the window", async () => {
    // All four queues empty: zero orgs, zero email lookups, zero sends.
    mocks.selectQueues.organizations = [[], [], [], []];
    await POST(makeRequest({ secret: CRON_SECRET }));
    expect(mocks.sendTrialReminderEmail).not.toHaveBeenCalled();
    expect(
      mocks.selectCalls.filter((c) => c.table === "organization_members"),
    ).toHaveLength(0);
  });
});

// ── Expirations: downgrade path ──────────────────────────────────────────────

describe("trial-expiration cron — downgrade path", () => {
  it("downgrades an org with no stripe_customer_id (never created a customer)", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Free Trial",
          plan: "club_small",
          stripe_customer_id: null,
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    // Stripe must NOT be touched — no customer means no payment method possible.
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();

    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values).toEqual({
      plan: "free",
      team_limit: 1,
      subscription_status: null,
    });
    // trial_ends_at MUST NOT be touched — it's the permanent "trial consumed"
    // gate.
    expect(update?.values).not.toHaveProperty("trial_ends_at");

    const body = await res.json();
    expect(body.expirations.downgraded).toBe(1);
  });

  it("downgrades when customer.invoice_settings.default_payment_method is null", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "No PM",
          plan: "club_large",
          stripe_customer_id: "cus_no_pm",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_no_pm",
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.customersRetrieve).toHaveBeenCalledWith("cus_no_pm");
    // Stop before any subscription work — null default PM is a downgrade.
    expect(mocks.subscriptionsList).not.toHaveBeenCalled();
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();

    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values.plan).toBe("free");
    expect(update?.values.team_limit).toBe(1);
    expect(update?.values.subscription_status).toBeNull();
  });

  it("downgrades when the customer record is deleted in Stripe", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Deleted Cust",
          plan: "club_small",
          stripe_customer_id: "cus_deleted",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_deleted",
      deleted: true,
    });

    await POST(makeRequest({ secret: CRON_SECRET }));
    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values.plan).toBe("free");
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
  });
});

// ── Expirations: conversion (create) path ────────────────────────────────────

describe("trial-expiration cron — conversion path (create)", () => {
  it("creates a subscription with default_payment_method + idempotency key, then persists", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Convert Co",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_visa" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_new" });

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    // Stripe call shape — the spec is explicit about each field.
    expect(mocks.subscriptionsList).toHaveBeenCalledWith({
      customer: "cus_x",
      status: "active",
      limit: 1,
    });
    expect(mocks.subscriptionsCreate).toHaveBeenCalledTimes(1);
    const [createArgs, createOpts] = mocks.subscriptionsCreate.mock.calls[0];
    expect(createArgs).toMatchObject({
      customer: "cus_x",
      items: [{ price: SMALL_PRICE }],
      default_payment_method: "pm_visa",
      metadata: { org_id: "org-1" },
    });
    expect(createOpts).toEqual({ idempotencyKey: "trial-convert-org-1" });

    // DB write happens AFTER the Stripe call, in a single update.
    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values).toEqual({
      stripe_subscription_id: "sub_new",
      subscription_status: "active",
    });

    const body = await res.json();
    expect(body.expirations.converted).toBe(1);
  });

  it("selects the LARGE price for a club_large trial", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-large",
          name: "Big Co",
          plan: "club_large",
          stripe_customer_id: "cus_y",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_y",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_amex" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_l" });

    await POST(makeRequest({ secret: CRON_SECRET }));
    const [createArgs] = mocks.subscriptionsCreate.mock.calls[0];
    expect(createArgs.items[0].price).toBe(LARGE_PRICE);
  });

  it("handles expanded payment_method objects (uses .id, not the whole object)", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Expanded PM",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: {
        default_payment_method: { id: "pm_card_expanded" },
      },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_new" });

    await POST(makeRequest({ secret: CRON_SECRET }));
    const [createArgs] = mocks.subscriptionsCreate.mock.calls[0];
    expect(createArgs.default_payment_method).toBe("pm_card_expanded");
  });
});

// ── Expirations: adopt existing active sub ───────────────────────────────────

describe("trial-expiration cron — adopt existing active sub", () => {
  it("adopts a pre-existing active subscription and skips subscriptions.create", async () => {
    // This branch matters because a previous cron run may have created the
    // subscription in Stripe successfully but failed to write the id to the DB.
    // Without this adoption logic the org stays stuck in 'trialing' forever and
    // the cron keeps retrying — past Stripe's 24h idempotency window, a retry
    // would attempt to create a second subscription.
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Stuck Trial",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_x" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({
      data: [{ id: "sub_already_active" }],
    });

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    // The Stripe create call must NOT fire — we already have a sub.
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();

    const update = findUpdate("organizations", {
      column: "id",
      value: "org-1",
    });
    expect(update?.values).toEqual({
      stripe_subscription_id: "sub_already_active",
      subscription_status: "active",
    });

    const body = await res.json();
    expect(body.expirations.adopted).toBe(1);
    expect(body.expirations.converted).toBe(0);
  });
});

// ── Expirations: idempotency guards ──────────────────────────────────────────

describe("trial-expiration cron — idempotency guards", () => {
  it("applies the spec idempotency filter (stripe_subscription_id IS NULL) at the query level", async () => {
    mocks.selectQueues.organizations = [[], [], [], []];
    await POST(makeRequest({ secret: CRON_SECRET }));

    const orgSelects = mocks.selectCalls.filter(
      (c) => c.table === "organizations",
    );
    const expirationSelect = orgSelects[3];
    expect(expirationSelect.filters).toContainEqual({
      op: "eq",
      column: "subscription_status",
      value: "trialing",
    });
    expect(
      expirationSelect.filters.find(
        (f) => f.op === "lt" && f.column === "trial_ends_at",
      )?.value,
    ).toBe(NOW.toISOString());
    expect(expirationSelect.filters).toContainEqual({
      op: "is",
      column: "stripe_subscription_id",
      value: null,
    });
  });

  it("counts subscriptions.create idempotency: a duplicate would resolve to the same sub id (asserted via key)", async () => {
    // The idempotency key alone is what makes this safe — there is no in-route
    // dedup logic. Pin the key shape so a future "let me make it slightly
    // different" regression is caught.
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-idem",
          name: "Idem Co",
          plan: "club_small",
          stripe_customer_id: "cus_idem",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_idem",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_idem" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_first" });

    await POST(makeRequest({ secret: CRON_SECRET }));
    const [, opts] = mocks.subscriptionsCreate.mock.calls[0];
    expect(opts.idempotencyKey).toBe("trial-convert-org-idem");
  });
});

// ── Expirations: defensive cases ─────────────────────────────────────────────

describe("trial-expiration cron — defensive cases", () => {
  it("skips an org whose plan is not a club tier (malformed state — never converts to 'free' price)", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Bad State",
          plan: "free",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(findUpdate("organizations", { column: "id", value: "org-1" }))
      .toBeUndefined();
    const body = await res.json();
    expect(body.expirations.skipped).toBe(1);
  });

  it("reports failed when the Stripe customer.retrieve call throws (no DB write so the next run retries)", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Stripe Down",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockRejectedValueOnce(new Error("Stripe error"));

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(findUpdate("organizations", { column: "id", value: "org-1" }))
      .toBeUndefined();
    const body = await res.json();
    expect(body.expirations.failed).toBe(1);
  });

  it("reports failed when subscriptions.create throws (no DB write so the next run retries via idempotency key)", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "Create Fails",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_x" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockRejectedValueOnce(new Error("card declined"));

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(findUpdate("organizations", { column: "id", value: "org-1" }))
      .toBeUndefined();
    const body = await res.json();
    expect(body.expirations.failed).toBe(1);
  });

  it("reports failed when priceIdForPlan throws because the env var is unset", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    // STRIPE_CLUB_*_PRICE_ID not set.

    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-1",
          name: "No Env",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(
            NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_x" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.expirations.failed).toBe(1);
  });

  it("processes multiple orgs in one run and reports per-bucket counts", async () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        // 1. Convert (creates sub).
        {
          id: "org-conv",
          name: "Convert Co",
          plan: "club_small",
          stripe_customer_id: "cus_conv",
          stripe_subscription_id: null,
          trial_ends_at: past,
        },
        // 2. Downgrade (no PM).
        {
          id: "org-down",
          name: "Down Co",
          plan: "club_large",
          stripe_customer_id: "cus_down",
          stripe_subscription_id: null,
          trial_ends_at: past,
        },
        // 3. Adopt existing sub.
        {
          id: "org-adopt",
          name: "Adopt Co",
          plan: "club_small",
          stripe_customer_id: "cus_adopt",
          stripe_subscription_id: null,
          trial_ends_at: past,
        },
      ],
    ];

    // org-conv: PM present, no existing sub → create
    mocks.customersRetrieve
      .mockResolvedValueOnce({
        id: "cus_conv",
        deleted: false,
        invoice_settings: { default_payment_method: "pm_conv" },
      })
      // org-down: no PM → downgrade
      .mockResolvedValueOnce({
        id: "cus_down",
        deleted: false,
        invoice_settings: { default_payment_method: null },
      })
      // org-adopt: PM present, existing sub → adopt
      .mockResolvedValueOnce({
        id: "cus_adopt",
        deleted: false,
        invoice_settings: { default_payment_method: "pm_adopt" },
      });

    // org-conv: empty list → create
    mocks.subscriptionsList
      .mockResolvedValueOnce({ data: [] })
      // org-adopt: existing sub
      .mockResolvedValueOnce({ data: [{ id: "sub_existing" }] });

    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_conv" });

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.expirations).toMatchObject({
      converted: 1,
      downgraded: 1,
      adopted: 1,
      failed: 0,
    });

    // Each org has its own update with the correct WHERE clause.
    expect(
      findUpdate("organizations", { column: "id", value: "org-conv" })?.values
        .stripe_subscription_id,
    ).toBe("sub_conv");
    expect(
      findUpdate("organizations", { column: "id", value: "org-down" })?.values
        .plan,
    ).toBe("free");
    expect(
      findUpdate("organizations", { column: "id", value: "org-adopt" })?.values
        .stripe_subscription_id,
    ).toBe("sub_existing");
  });
});

// ── Email fan-out: conversion / downgrade ────────────────────────────────────

describe("trial-expiration cron — email fan-out (conversion / downgrade)", () => {
  it("sends a 'converted' email with the correct tier after a successful create-path conversion", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-conv",
          name: "Convert Co",
          plan: "club_large",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_x" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_new" });

    await POST(makeRequest({ secret: CRON_SECRET }));

    // The email send happens AFTER the DB write so the org row already
    // reflects 'active' state by the time the owner clicks through.
    expect(mocks.sendTrialConvertedEmail).toHaveBeenCalledTimes(1);
    const [, orgId, tier, orgName] =
      mocks.sendTrialConvertedEmail.mock.calls[0];
    expect(orgId).toBe("org-conv");
    expect(tier).toBe("club_large");
    expect(orgName).toBe("Convert Co");
    // No downgrade in the conversion path.
    expect(mocks.sendTrialDowngradedEmail).not.toHaveBeenCalled();
  });

  it("sends a 'converted' email after the adopt-existing-active branch", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-adopt",
          name: "Adopt Co",
          plan: "club_small",
          stripe_customer_id: "cus_y",
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_y",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_y" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({
      data: [{ id: "sub_existing" }],
    });

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.sendTrialConvertedEmail).toHaveBeenCalledTimes(1);
    const [, orgId, tier, orgName] =
      mocks.sendTrialConvertedEmail.mock.calls[0];
    expect(orgId).toBe("org-adopt");
    // Tier comes from org.plan, not from the adopted Stripe price — the trial
    // was started on Small/Large via start-trial, so org.plan is authoritative.
    expect(tier).toBe("club_small");
    expect(orgName).toBe("Adopt Co");
  });

  it("sends a 'downgraded' email when the org has no stripe_customer_id", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-down",
          name: "Down Co",
          plan: "club_small",
          stripe_customer_id: null,
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.sendTrialDowngradedEmail).toHaveBeenCalledTimes(1);
    const [, orgId, orgName] = mocks.sendTrialDowngradedEmail.mock.calls[0];
    expect(orgId).toBe("org-down");
    expect(orgName).toBe("Down Co");
    expect(mocks.sendTrialConvertedEmail).not.toHaveBeenCalled();
  });

  it("sends a 'downgraded' email when the customer has no default payment method", async () => {
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-down-pm",
          name: "No PM Co",
          plan: "club_large",
          stripe_customer_id: "cus_no_pm",
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_no_pm",
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.sendTrialDowngradedEmail).toHaveBeenCalledTimes(1);
    const [, orgId] = mocks.sendTrialDowngradedEmail.mock.calls[0];
    expect(orgId).toBe("org-down-pm");
  });

  it("does NOT send any email when the DB downgrade write itself fails", async () => {
    // If the DB write failed the org is still in 'trialing' — sending a
    // "downgraded" email would lie about the visible state.
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-db-fail",
          name: "DB Fail",
          plan: "club_small",
          stripe_customer_id: null,
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];
    mocks.updateErrors.organizations = new Error("constraint violation");

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.sendTrialDowngradedEmail).not.toHaveBeenCalled();
    expect(mocks.sendTrialConvertedEmail).not.toHaveBeenCalled();
  });

  it("does NOT send a 'converted' email when the DB write after subscriptions.create fails", async () => {
    // Same invariant in the conversion path: the cron will retry next run, so
    // the email should not be sent against the not-yet-persisted state.
    mocks.selectQueues.organizations = [
      [], [], [],
      [
        {
          id: "org-conv-db-fail",
          name: "Conv DB Fail",
          plan: "club_small",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: null,
          trial_ends_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
    ];
    mocks.customersRetrieve.mockResolvedValueOnce({
      id: "cus_x",
      deleted: false,
      invoice_settings: { default_payment_method: "pm_x" },
    });
    mocks.subscriptionsList.mockResolvedValueOnce({ data: [] });
    mocks.subscriptionsCreate.mockResolvedValueOnce({ id: "sub_new" });
    mocks.updateErrors.organizations = new Error("DB write failed");

    await POST(makeRequest({ secret: CRON_SECRET }));

    expect(mocks.sendTrialConvertedEmail).not.toHaveBeenCalled();
  });
});
