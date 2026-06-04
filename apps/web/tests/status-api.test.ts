/**
 * Unit tests for GET /api/billing/status.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Club Billing Page" matrix
 * and the status row of "Route Authorization & State Requirements"
 * (owner or director — distinct from the mutation routes which are owner-only).
 *
 * Covers:
 *   - Authentication (401 when not signed in).
 *   - Org resolution: explicit `?orgId=` query param vs. implicit via
 *     `profiles.active_team_id → teams.organization_id`.
 *   - Authorization: owner AND director both allowed (read access matrix);
 *     manager/coach/parent/player rejected with 403; non-members 403.
 *   - Response shape: every field the Club Billing / Plan tab UI needs to
 *     render the spec's badge matrix and gate the action buttons.
 *   - Trial days remaining computation — only when status='trialing' and
 *     trial_ends_at is non-null; clamped to 0 when past; null otherwise so
 *     callers don't accidentally render a negative or stale countdown for
 *     non-trialing orgs (admin-upgraded rows have trial_ends_at stamped as
 *     the trial-consumed gate, not as a displayed value).
 *
 * All Supabase calls are mocked — no Stripe interaction in this route.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockResolveRequestUser = vi.fn();

  const tableData: Record<string, unknown> = {};

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
  }));

  return { mockResolveRequestUser, mockFrom, tableData };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.mockResolveRequestUser,
  adminClient: () => ({ from: mocks.mockFrom }),
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { GET } from "@/app/api/billing/status/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED_USER = { id: "auth-user-uuid" };
const PROFILE = { id: "profile-uuid", active_team_id: "team-1" };

function makeRequest(query = ""): Request {
  return new Request(`http://localhost:3000/api/billing/status${query}`, {
    method: "GET",
  });
}

function resetState() {
  vi.clearAllMocks();
  Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
}

/**
 * Seed the four reads the implicit-resolution path performs:
 *   profiles → teams → organization_members → organizations.
 * Callers can override any one (e.g. set `role: "director"`) by passing a
 * partial override that is merged into the defaults.
 */
function seedHappyPath(
  overrides: {
    profile?: Record<string, unknown> | null;
    team?: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
    organization?: Record<string, unknown> | null;
  } = {},
) {
  mocks.mockResolveRequestUser.mockResolvedValue(AUTHED_USER);
  mocks.tableData.profiles = overrides.profile !== undefined
    ? overrides.profile
    : PROFILE;
  mocks.tableData.teams = overrides.team !== undefined
    ? overrides.team
    : { organization_id: "org-1" };
  mocks.tableData.organization_members = overrides.membership !== undefined
    ? overrides.membership
    : { role: "owner" };
  mocks.tableData.organizations = overrides.organization !== undefined
    ? overrides.organization
    : {
        id: "org-1",
        plan: "club_large",
        subscription_status: "active",
        team_limit: null,
        trial_ends_at: null,
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      };
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("GET /api/billing/status — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.mockResolveRequestUser.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No Supabase reads after auth fails.
    expect(mocks.mockFrom).not.toHaveBeenCalled();
  });
});

// ── Org resolution ────────────────────────────────────────────────────────────

describe("GET /api/billing/status — org resolution", () => {
  it("returns 404 'profile_not_found' when caller has no profile", async () => {
    seedHappyPath({ profile: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("profile_not_found");
  });

  it("returns 404 'no_active_team' when no orgId param and profile has no active_team_id", async () => {
    seedHappyPath({ profile: { id: "profile-uuid", active_team_id: null } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_active_team");
  });

  it("returns 404 'no_organization' when active team has no organization_id", async () => {
    seedHappyPath({ team: { organization_id: null } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_organization");
  });

  it("uses explicit ?orgId param without requiring an active team", async () => {
    // A user with no active team can still query a specific org's billing
    // state, as long as they're owner/director of it. This is the form the
    // settings page will use once it has the org id loaded.
    seedHappyPath({
      profile: { id: "profile-uuid", active_team_id: null },
      // teams must not be consulted when orgId is given explicitly.
      team: null,
      organization: {
        id: "org-explicit",
        plan: "club_small",
        subscription_status: "trialing",
        team_limit: 10,
        trial_ends_at: null,
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });
    const res = await GET(makeRequest("?orgId=org-explicit"));
    expect(res.status).toBe(200);
    expect((await res.json()).orgId).toBe("org-explicit");
  });
});

// ── Authorization (org-level owner or director) ───────────────────────────────

describe("GET /api/billing/status — authorization", () => {
  it("returns 403 when caller is not an org member at all", async () => {
    seedHappyPath({ membership: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("allows the owner", async () => {
    seedHappyPath({ membership: { role: "owner" } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it("allows directors (spec read-access matrix)", async () => {
    // Directors don't have mutation rights but the spec explicitly grants
    // them read access to billing state — they need to see the current plan
    // and trial countdown to make purchasing decisions on the owner's behalf.
    seedHappyPath({ membership: { role: "director" } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it.each([["coach"], ["manager"], ["parent"], ["player"]])(
    "rejects %s — not in the owner/director read whitelist",
    async (role) => {
      seedHappyPath({ membership: { role } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("forbidden");
    },
  );

  it("returns 404 'org_not_found' when the org row is missing", async () => {
    seedHappyPath({ organization: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_not_found");
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("GET /api/billing/status — response shape", () => {
  it("returns every field the billing UI needs for an active club_large org", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "active",
        team_limit: null,
        trial_ends_at: null,
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: "cus_abc",
        stripe_subscription_id: "sub_abc",
      },
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "org-1",
      plan: "club_large",
      subscriptionStatus: "active",
      teamLimit: null,
      trialEndsAt: null,
      trialDaysRemaining: null,
      pendingPlan: null,
      pendingPlanAt: null,
      subscriptionCancelAt: null,
      hasStripeCustomer: true,
      hasStripeSubscription: true,
    });
  });

  it("reports a free org with no Stripe customer/sub correctly", async () => {
    // Drives the Plan tab's "show pricing" branch — flags must be false so
    // the UI knows not to render the portal/manage buttons.
    seedHappyPath({
      organization: {
        id: "org-free",
        plan: "free",
        subscription_status: null,
        team_limit: 1,
        trial_ends_at: null,
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.plan).toBe("free");
    expect(body.subscriptionStatus).toBeNull();
    expect(body.teamLimit).toBe(1);
    expect(body.hasStripeCustomer).toBe(false);
    expect(body.hasStripeSubscription).toBe(false);
  });

  it("flags 'Managed account' state — active without a Stripe subscription id", async () => {
    // The admin/pilot-upgrade row (spec): subscription_status='active' AND
    // stripe_subscription_id IS NULL → the UI shows the "Managed account —
    // contact us to make changes" note in place of action buttons.
    seedHappyPath({
      organization: {
        id: "org-managed",
        plan: "club_large",
        subscription_status: "active",
        team_limit: null,
        trial_ends_at: "2026-01-01T00:00:00.000Z", // stamped by admin-upgrade
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.subscriptionStatus).toBe("active");
    expect(body.hasStripeSubscription).toBe(false);
    // trial_ends_at is exposed but trialDaysRemaining stays null because the
    // org is not trialing — admin-stamped trial_ends_at is not a countdown.
    expect(body.trialEndsAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.trialDaysRemaining).toBeNull();
  });
});

// ── State-matrix coverage (Club Billing badge table) ──────────────────────────

describe("GET /api/billing/status — Club Billing badge matrix", () => {
  it("Trial: returns trialEndsAt and a positive trialDaysRemaining", async () => {
    // Pin clock so the test is deterministic regardless of when CI runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_small",
        subscription_status: "trialing",
        team_limit: 10,
        trial_ends_at: "2026-05-31T00:00:00.000Z", // exactly 30 days out
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.subscriptionStatus).toBe("trialing");
    expect(body.trialEndsAt).toBe("2026-05-31T00:00:00.000Z");
    expect(body.trialDaysRemaining).toBe(30);
  });

  it("Trial: clamps trialDaysRemaining to 0 when trial_ends_at is in the past", async () => {
    // The cron is what flips the status — until it runs, the status can be
    // 'trialing' with a past trial_ends_at. The UI shouldn't display a
    // negative day count.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_small",
        subscription_status: "trialing",
        team_limit: 10,
        trial_ends_at: "2026-04-25T00:00:00.000Z", // 6 days ago
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });

    const res = await GET(makeRequest());
    expect((await res.json()).trialDaysRemaining).toBe(0);
  });

  it("Trial: rounds partial days up so a sub-24h remainder still shows as 1", async () => {
    // UI rule from spec narrative: "Your trial ends … X days remaining".
    // 23.5 hours left must read as "1 day", not "0 days".
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "trialing",
        team_limit: null,
        trial_ends_at: new Date(
          Date.now() + 23.5 * 60 * 60 * 1000,
        ).toISOString(),
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    });

    const res = await GET(makeRequest());
    expect((await res.json()).trialDaysRemaining).toBe(1);
  });

  it("Active (clean): pending_plan and cancel_at both null", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "active",
        team_limit: null,
        trial_ends_at: "2026-01-01T00:00:00.000Z",
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      },
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.subscriptionStatus).toBe("active");
    expect(body.pendingPlan).toBeNull();
    expect(body.subscriptionCancelAt).toBeNull();
  });

  it("Downgrading: surfaces pending_plan + pending_plan_at for the Large→Small badge", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "active",
        team_limit: null,
        trial_ends_at: "2026-01-01T00:00:00.000Z",
        pending_plan: "club_small",
        pending_plan_at: "2026-06-01T00:00:00.000Z",
        subscription_cancel_at: null,
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      },
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.pendingPlan).toBe("club_small");
    expect(body.pendingPlanAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("Canceling: surfaces subscription_cancel_at for the badge + reactivate gate", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_small",
        subscription_status: "active",
        team_limit: 10,
        trial_ends_at: "2026-01-01T00:00:00.000Z",
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: "2026-06-15T00:00:00.000Z",
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      },
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.subscriptionCancelAt).toBe("2026-06-15T00:00:00.000Z");
  });

  it("Past Due: passes through the past_due status for the warn badge", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "past_due",
        team_limit: null,
        trial_ends_at: "2026-01-01T00:00:00.000Z",
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      },
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.subscriptionStatus).toBe("past_due");
  });

  it("Canceled: surfaces the terminal status (no countdown, no buttons)", async () => {
    seedHappyPath({
      organization: {
        id: "org-1",
        plan: "club_large",
        subscription_status: "canceled",
        team_limit: null,
        trial_ends_at: "2026-01-01T00:00:00.000Z",
        pending_plan: null,
        pending_plan_at: null,
        subscription_cancel_at: null,
        stripe_customer_id: "cus_x",
        stripe_subscription_id: "sub_x",
      },
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.subscriptionStatus).toBe("canceled");
    expect(body.trialDaysRemaining).toBeNull();
  });
});
