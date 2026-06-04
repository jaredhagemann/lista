/**
 * Unit tests for POST /api/billing/change-plan.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Club Small → Club Large
 * (upgrade…)", "Club Large → Club Small (downgrade)", and the change-plan row
 * of "Route Authorization & State Requirements".
 *
 * Covers the four spec transitions plus their guard rails:
 *   1. Trial small ↔ large — DB-only flip of plan + team_limit, no Stripe.
 *   2. Active small → large — Stripe subscriptions.update price swap, NO DB
 *      write (the webhook does it).
 *   3. Active large → small — Subscription Schedule create + update with a
 *      period-end phase, DB write of pending_plan / pending_plan_at /
 *      stripe_schedule_id (plan/team_limit unchanged).
 *   4. Re-upgrade Large with a pending small schedule — cancels the schedule
 *      via subscriptionSchedules.cancel; the webhook clears pending_*.
 *
 * Also pins:
 *   - The full auth/precondition matrix (401/400/403/404 paths).
 *   - The stable JSON error keys the UI branches on.
 *   - That route never writes plan/team_limit for active subs (webhook owns it).
 *   - That re-issuing a Large→Small request while a schedule already exists
 *     is rejected (we never stack two pending downgrades).
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

  const subscriptionsRetrieve = vi.fn();
  const subscriptionsUpdate = vi.fn();
  const subscriptionSchedulesCreate = vi.fn();
  const subscriptionSchedulesUpdate = vi.fn();
  const subscriptionSchedulesCancel = vi.fn();

  return {
    mockResolveRequestUser,
    mockFrom,
    tableData,
    updateErrors,
    updates,
    subscriptionsRetrieve,
    subscriptionsUpdate,
    subscriptionSchedulesCreate,
    subscriptionSchedulesUpdate,
    subscriptionSchedulesCancel,
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: mocks.subscriptionsRetrieve,
      update: mocks.subscriptionsUpdate,
    },
    subscriptionSchedules: {
      create: mocks.subscriptionSchedulesCreate,
      update: mocks.subscriptionSchedulesUpdate,
      cancel: mocks.subscriptionSchedulesCancel,
    },
  }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { POST } from "@/app/api/billing/change-plan/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid" };
const SMALL_PRICE = "price_test_small_abc";
const LARGE_PRICE = "price_test_large_xyz";
const CURRENT_PERIOD_END = 1735689600; // 2025-01-01T00:00:00Z (Unix seconds)

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/billing/change-plan", {
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

  // Happy-path Stripe defaults; tests override per-case.
  mocks.subscriptionsRetrieve.mockResolvedValue({
    id: "sub_existing",
    items: { data: [{ id: "si_existing", price: { id: LARGE_PRICE } }] },
  });
  mocks.subscriptionsUpdate.mockResolvedValue({ id: "sub_existing" });
  mocks.subscriptionSchedulesCreate.mockResolvedValue({
    id: "sub_sched_abc",
    phases: [
      {
        start_date: CURRENT_PERIOD_END - 30 * 24 * 60 * 60,
        end_date: CURRENT_PERIOD_END,
        items: [{ price: LARGE_PRICE, quantity: 1 }],
      },
    ],
  });
  mocks.subscriptionSchedulesUpdate.mockResolvedValue({ id: "sub_sched_abc" });
  mocks.subscriptionSchedulesCancel.mockResolvedValue({ id: "sub_sched_abc" });
}

function seedOwner(
  org: Record<string, unknown> = {
    id: "org-1",
    plan: "club_small",
    subscription_status: "trialing",
    stripe_subscription_id: null,
    stripe_schedule_id: null,
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
  vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_PRICE);
  vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_PRICE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("POST /api/billing/change-plan — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No Stripe interaction must occur on unauthenticated requests.
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCancel).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/billing/change-plan — input validation", () => {
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
    // Defence-in-depth: a stale client must not be able to "switch" to the
    // retired enum value — there is no env-configured price for it.
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

describe("POST /api/billing/change-plan — authorization", () => {
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
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
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

describe("POST /api/billing/change-plan — precondition matrix", () => {
  it("returns 400 'not_club_plan' when current plan is 'free'", async () => {
    seedOwner({
      id: "org-1",
      plan: "free",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      pending_plan: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
  });

  it("returns 400 'not_club_plan' for the retired legacy 'club' plan value on the org row", async () => {
    // Defence-in-depth: if migration backfill somehow missed a row, the
    // route must refuse rather than dispatch through the trial/active
    // branches with an unknown current plan.
    seedOwner({
      id: "org-1",
      plan: "club",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      stripe_schedule_id: null,
      pending_plan: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_club_plan");
  });

  it.each([
    ["past_due"],
    ["canceled"],
    [null],
  ])(
    "returns 400 'not_active_or_trialing' when subscription_status is %s",
    async (status) => {
      seedOwner({
        id: "org-1",
        plan: "club_large",
        subscription_status: status,
        stripe_subscription_id: "sub_x",
        stripe_schedule_id: null,
        pending_plan: null,
      });
      const res = await POST(
        makeRequest({ orgId: "org-1", plan: "club_small" }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("not_active_or_trialing");
      expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
      expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
    },
  );

  it("returns 400 'no_subscription' when active but stripe_subscription_id is null", async () => {
    // This is the "Managed account" pilot/admin-upgrade row (active without
    // a Stripe sub). The spec mandates stripe_subscription_id IS NOT NULL on
    // active for change-plan because there is literally nothing in Stripe to
    // update.
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      pending_plan: null,
    });
    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_subscription");
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["club_small"],
    ["club_large"],
  ])(
    "returns 400 'same_plan' when org is %s and the request matches (no pending schedule)",
    async (plan) => {
      seedOwner({
        id: "org-1",
        plan,
        subscription_status: "active",
        stripe_subscription_id: "sub_x",
        stripe_schedule_id: null,
        pending_plan: null,
      });
      const res = await POST(makeRequest({ orgId: "org-1", plan }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("same_plan");
      expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
      expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
      expect(mocks.subscriptionSchedulesCancel).not.toHaveBeenCalled();
    },
  );
});

// ── Branch 1: trial transitions are DB-only ───────────────────────────────────

describe("POST /api/billing/change-plan — trial transitions (DB-only)", () => {
  it("Trial Small → Large: writes plan='club_large', team_limit=null; no Stripe call", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      pending_plan: null,
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "trial_plan_changed",
    });

    expect(mocks.updates.organizations).toHaveLength(1);
    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload).toEqual({
      plan: "club_large",
      team_limit: null,
    });
    // Trial duration is unchanged — must NOT touch trial_ends_at.
    expect(payload).not.toHaveProperty("trial_ends_at");
    // Subscription status stays 'trialing' — must NOT be rewritten here.
    expect(payload).not.toHaveProperty("subscription_status");

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
  });

  it("Trial Large → Small: writes plan='club_small', team_limit=10; no Stripe call", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      pending_plan: null,
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload).toEqual({
      plan: "club_small",
      team_limit: 10,
    });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
  });

  it("returns 500 when the DB update fails on a trial transition", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      pending_plan: null,
    });
    mocks.updateErrors.organizations = { message: "db trial error" };

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db trial error");
  });
});

// ── Branch 2: active Small → Large (immediate Stripe swap) ────────────────────

describe("POST /api/billing/change-plan — active Small → Large", () => {
  it("retrieves the subscription, swaps the item price, returns kind='subscription_updated'", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_active_small",
      stripe_schedule_id: null,
      pending_plan: null,
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_active_small",
      items: { data: [{ id: "si_small_001", price: { id: SMALL_PRICE } }] },
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "subscription_updated",
    });

    // Stripe subscription retrieved by id, then updated with the new price
    // and the existing item id. Proration is delegated to Stripe explicitly.
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith(
      "sub_active_small",
    );
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      "sub_active_small",
      {
        items: [{ id: "si_small_001", price: LARGE_PRICE }],
        proration_behavior: "create_prorations",
      },
    );

    // The webhook is the sole writer of plan/team_limit on active subs —
    // this route must NOT pre-empt it.
    expect(mocks.updates.organizations).toBeUndefined();

    // No schedule path was triggered.
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 if the retrieved subscription has no items (Stripe shape regression)", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      stripe_schedule_id: null,
      pending_plan: null,
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_x",
      items: { data: [] },
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("subscription_item_missing");
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("uses STRIPE_CLUB_LARGE_PRICE_ID — throws when env is missing (route returns 500 to Next)", async () => {
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", "");
    seedOwner({
      id: "org-1",
      plan: "club_small",
      subscription_status: "active",
      stripe_subscription_id: "sub_x",
      stripe_schedule_id: null,
      pending_plan: null,
    });
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_x",
      items: { data: [{ id: "si_x", price: { id: SMALL_PRICE } }] },
    });

    // priceIdForPlan throws synchronously on missing env. Next renders this
    // as a 500 in production; we assert by promise-rejection (matches the
    // contract used in start-trial / create-checkout tests).
    await expect(
      POST(makeRequest({ orgId: "org-1", plan: "club_large" })),
    ).rejects.toThrow(/STRIPE_CLUB_LARGE_PRICE_ID/);
  });
});

// ── Branch 3: active Large → Small (deferred via schedule) ────────────────────

describe("POST /api/billing/change-plan — active Large → Small (deferred)", () => {
  function seedLargeActive() {
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_active_large",
      stripe_schedule_id: null,
      pending_plan: null,
    });
  }

  it("creates schedule from_subscription with org metadata", async () => {
    seedLargeActive();

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    expect(mocks.subscriptionSchedulesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionSchedulesCreate).toHaveBeenCalledWith({
      from_subscription: "sub_active_large",
      metadata: { org_id: "org-1" },
    });
  });

  it("appends a Small phase starting at the current period end", async () => {
    seedLargeActive();
    mocks.subscriptionSchedulesCreate.mockResolvedValue({
      id: "sub_sched_xyz",
      phases: [
        {
          start_date: CURRENT_PERIOD_END - 30 * 24 * 60 * 60,
          end_date: CURRENT_PERIOD_END,
          // Items are unexpanded by default — price is a string.
          items: [{ price: LARGE_PRICE, quantity: 1 }],
        },
      ],
    });

    await POST(makeRequest({ orgId: "org-1", plan: "club_small" }));

    expect(mocks.subscriptionSchedulesUpdate).toHaveBeenCalledTimes(1);
    const [scheduleId, updateArgs] =
      mocks.subscriptionSchedulesUpdate.mock.calls[0];
    expect(scheduleId).toBe("sub_sched_xyz");

    expect(updateArgs.phases).toHaveLength(2);
    // Phase 0 is the current phase round-tripped verbatim — the only change
    // is appending a successor phase.
    expect(updateArgs.phases[0]).toEqual({
      items: [{ price: LARGE_PRICE, quantity: 1 }],
      start_date: CURRENT_PERIOD_END - 30 * 24 * 60 * 60,
      end_date: CURRENT_PERIOD_END,
    });
    // Phase 1 is the Small downgrade starting exactly at the prior period end.
    expect(updateArgs.phases[1]).toEqual({
      items: [{ price: SMALL_PRICE, quantity: 1 }],
      start_date: CURRENT_PERIOD_END,
    });
  });

  it("normalises an expanded price object on the current phase item back to a string id", async () => {
    // Stripe expands `price` to an object when callers request expansion. The
    // schedule update endpoint only accepts a price id string, so the route
    // must normalise before passing through.
    seedLargeActive();
    mocks.subscriptionSchedulesCreate.mockResolvedValue({
      id: "sub_sched_expanded",
      phases: [
        {
          start_date: CURRENT_PERIOD_END - 30 * 24 * 60 * 60,
          end_date: CURRENT_PERIOD_END,
          items: [{ price: { id: LARGE_PRICE, product: "prod_x" }, quantity: 1 }],
        },
      ],
    });

    await POST(makeRequest({ orgId: "org-1", plan: "club_small" }));

    const [, updateArgs] = mocks.subscriptionSchedulesUpdate.mock.calls[0];
    expect(updateArgs.phases[0].items[0].price).toBe(LARGE_PRICE);
  });

  it("writes pending_plan / pending_plan_at / stripe_schedule_id, NOT plan / team_limit", async () => {
    seedLargeActive();
    mocks.subscriptionSchedulesCreate.mockResolvedValue({
      id: "sub_sched_pending_1",
      phases: [
        {
          start_date: CURRENT_PERIOD_END - 30 * 24 * 60 * 60,
          end_date: CURRENT_PERIOD_END,
          items: [{ price: LARGE_PRICE, quantity: 1 }],
        },
      ],
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);

    expect(mocks.updates.organizations).toHaveLength(1);
    const payload = mocks.updates.organizations![0] as Record<string, unknown>;
    expect(payload.pending_plan).toBe("club_small");
    expect(payload.stripe_schedule_id).toBe("sub_sched_pending_1");
    // pending_plan_at is the Unix-seconds value converted to ISO 8601 so the
    // UI can format it without re-fetching the schedule.
    expect(payload.pending_plan_at).toBe(
      new Date(CURRENT_PERIOD_END * 1000).toISOString(),
    );

    // Spec: plan and team_limit stay on Large until the schedule executes.
    // The webhook (customer.subscription.updated with the small price) is
    // the sole writer for those fields.
    expect(payload).not.toHaveProperty("plan");
    expect(payload).not.toHaveProperty("team_limit");
  });

  it("returns kind='downgrade_scheduled' and the ISO pendingPlanAt", async () => {
    seedLargeActive();

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("downgrade_scheduled");
    expect(body.pendingPlanAt).toBe(
      new Date(CURRENT_PERIOD_END * 1000).toISOString(),
    );
  });

  it("returns 400 'pending_plan_change' when a schedule already exists (Large→Small re-request)", async () => {
    // Stacking two pending downgrades silently would orphan a schedule in
    // Stripe and lose the link in stripe_schedule_id. Refuse — the user
    // must undo first via the re-upgrade path (Branch 4).
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_active_large",
      stripe_schedule_id: "sub_sched_already",
      pending_plan: "club_small",
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pending_plan_change");
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when the DB update fails after schedule creation", async () => {
    // The schedule succeeded in Stripe but the DB stamp failed. The route
    // surfaces the DB error to the caller (manual reconciliation may be
    // needed — flagged for follow-up in the trial-cron item).
    seedLargeActive();
    mocks.updateErrors.organizations = { message: "db sched error" };

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_small" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db sched error");
  });
});

// ── Branch 4: re-upgrade cancels a pending Large → Small schedule ─────────────

describe("POST /api/billing/change-plan — re-upgrade Large cancels pending Small schedule", () => {
  it("calls subscriptionSchedules.cancel and does NOT touch plan/team_limit", async () => {
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "active",
      stripe_subscription_id: "sub_active_large",
      stripe_schedule_id: "sub_sched_pending_xyz",
      pending_plan: "club_small",
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "schedule_canceled",
    });

    expect(mocks.subscriptionSchedulesCancel).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionSchedulesCancel).toHaveBeenCalledWith(
      "sub_sched_pending_xyz",
    );

    // No subscriptions.update; no schedule create; no DB writes — the webhook
    // (subscription_schedule.canceled) is responsible for clearing
    // pending_plan / pending_plan_at / stripe_schedule_id.
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionSchedulesUpdate).not.toHaveBeenCalled();
    expect(mocks.updates.organizations).toBeUndefined();
  });

  it("works for a trialing org with a stray schedule id too (defensive)", async () => {
    // Trials shouldn't normally have a schedule, but a stale row should
    // still be cleanable through this path rather than wedging the user.
    seedOwner({
      id: "org-1",
      plan: "club_large",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_schedule_id: "sub_sched_stray",
      pending_plan: "club_small",
    });

    const res = await POST(
      makeRequest({ orgId: "org-1", plan: "club_large" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.subscriptionSchedulesCancel).toHaveBeenCalledWith(
      "sub_sched_stray",
    );
  });
});
