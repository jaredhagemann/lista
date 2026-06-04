/**
 * Component-level tests for PlanTabClient — the spec's
 * "Pricing / Upgrade Page" UI at /dashboard/settings?tab=plan.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "UI Requirements →
 * Pricing / Upgrade Page" and the Testing Checklist line
 *   "Free org owner sees pricing comparison and can start a trial".
 *
 * Covers the CTA / banner matrix the component drives off `orgPlan`:
 *
 *   - Three-column comparison (Free | Club Small | Club Large) renders for all
 *     owners regardless of current plan.
 *   - Current plan is highlighted with a "Current" badge.
 *   - Free + trial-not-used: "Start 90-day free trial" CTA → POST start-trial
 *     → router.push("/dashboard/club").
 *   - Free + trial-already-used (covers both an actual prior trial AND the
 *     legacy-club backfill): "Subscribe" CTA → POST create-checkout → Stripe.
 *   - start-trial returning `trial_already_used` is gracefully caught and
 *     falls through to checkout — the spec's documented routing for orgs that
 *     re-attempt a trial.
 *   - Trialing: top banner shows X days remaining (singular vs plural) + "Add
 *     payment method" CTA → POST create-setup → Stripe URL.
 *   - Active/past_due: top banner with "Manage billing" link to
 *     /dashboard/club/billing (per-status copy differs for past_due).
 *   - Non-owner director: contact-owner notice, no CTAs (mutation routes are
 *     owner-only — this prevents 403s the user can't act on).
 *   - No orgPlan (no active team / team has no org): create-team prompt
 *     instead of CTAs (start-trial requires an orgId).
 *   - Admin-code dialog: tier picker, code submission, error branches.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

import { PlanTabClient, type OrgPlanData } from "@/components/settings/plan-tab-client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseOrgPlan(overrides: Partial<OrgPlanData> = {}): OrgPlanData {
  return {
    id: "org-1",
    plan: "free",
    subscriptionStatus: null,
    teamLimit: 1,
    trialEndsAt: null,
    trialDaysRemaining: null,
    pendingPlan: null,
    subscriptionCancelAt: null,
    hasStripeSubscription: false,
    orgRole: "owner",
    ...overrides,
  };
}

/**
 * Test fetch handler — routes by path to a per-route handler so each test can
 * register only the routes it cares about. Records calls for assertions.
 */
type FetchCall = { url: string; init: RequestInit | undefined };

function installFetch(
  handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [path, handler] of Object.entries(handlers)) {
      if (url === path) return handler(init);
    }
    return new Response(JSON.stringify({ error: "unhandled" }), { status: 500 });
  });
  // jsdom provides a `fetch` global; replace it on globalThis.
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // jsdom doesn't implement navigation, so window.location.href assignments
  // would throw. Replace the property with a writable one for tests that
  // exercise Stripe redirects.
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
  });
});

// ── Three-column comparison rendering ────────────────────────────────────────

describe("PlanTabClient — pricing comparison rendering", () => {
  it("renders all three pricing columns for a free owner", () => {
    render(<PlanTabClient orgPlan={baseOrgPlan()} />);

    expect(screen.getByTestId("pricing-column-free")).toBeTruthy();
    expect(screen.getByTestId("pricing-column-club_small")).toBeTruthy();
    expect(screen.getByTestId("pricing-column-club_large")).toBeTruthy();
    // Prices visible in their columns.
    expect(
      within(screen.getByTestId("pricing-column-club_small")).getByText("$99"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("pricing-column-club_large")).getByText("$299"),
    ).toBeTruthy();
  });

  it("marks Free as Current for a free org", () => {
    render(<PlanTabClient orgPlan={baseOrgPlan()} />);

    const free = screen.getByTestId("pricing-column-free");
    expect(within(free).getByText("Current")).toBeTruthy();
    // Other columns must not have the Current badge.
    expect(
      within(screen.getByTestId("pricing-column-club_small")).queryByText(
        "Current",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("pricing-column-club_large")).queryByText(
        "Current",
      ),
    ).toBeNull();
  });

  it("marks Club Small as Current for an active club_small org", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_small",
          subscriptionStatus: "active",
          teamLimit: 10,
          trialEndsAt: new Date().toISOString(),
          hasStripeSubscription: true,
        })}
      />,
    );

    expect(
      within(screen.getByTestId("pricing-column-club_small")).getByText(
        "Current",
      ),
    ).toBeTruthy();
  });

  it("marks Club Large as Current for an active club_large org", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_large",
          subscriptionStatus: "active",
          teamLimit: null,
          trialEndsAt: new Date().toISOString(),
          hasStripeSubscription: true,
        })}
      />,
    );

    expect(
      within(screen.getByTestId("pricing-column-club_large")).getByText(
        "Current",
      ),
    ).toBeTruthy();
  });
});

// ── Free owner → Start trial ──────────────────────────────────────────────────

describe("PlanTabClient — start trial CTA (free owner, no prior trial)", () => {
  it("shows 'Start 90-day free trial' on each club tier", () => {
    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    // Two club tiers → two trial buttons.
    expect(
      screen.getAllByRole("button", { name: /start 90-day free trial/i }),
    ).toHaveLength(2);
  });

  it("POSTs to /api/billing/start-trial with the picked tier and redirects to /dashboard/club", async () => {
    const { calls } = installFetch({
      "/api/billing/start-trial": () =>
        new Response(JSON.stringify({ ok: true, trialEndsAt: "2026-08-19" }), {
          status: 200,
        }),
    });

    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    const user = userEvent.setup();

    const smallCol = screen.getByTestId("pricing-column-club_small");
    await user.click(
      within(smallCol).getByRole("button", { name: /start 90-day free trial/i }),
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/club"));
    expect(mockRefresh).toHaveBeenCalled();

    const call = calls.find((c) => c.url === "/api/billing/start-trial");
    expect(call).toBeDefined();
    expect(JSON.parse(call!.init!.body as string)).toEqual({
      orgId: "org-1",
      plan: "club_small",
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("falls through to checkout when start-trial returns 'trial_already_used'", async () => {
    // Simulates the legacy-backfill case where trial_ends_at was set on the
    // server but the client still believed the trial was available.
    const { calls } = installFetch({
      "/api/billing/start-trial": () =>
        new Response(JSON.stringify({ error: "trial_already_used" }), {
          status: 400,
        }),
      "/api/billing/create-checkout": () =>
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/pay/abc" }),
          { status: 200 },
        ),
    });

    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    const user = userEvent.setup();
    const largeCol = screen.getByTestId("pricing-column-club_large");
    await user.click(
      within(largeCol).getByRole("button", { name: /start 90-day free trial/i }),
    );

    await waitFor(() => {
      expect(
        calls.find((c) => c.url === "/api/billing/create-checkout"),
      ).toBeDefined();
    });

    const checkoutCall = calls.find(
      (c) => c.url === "/api/billing/create-checkout",
    )!;
    expect(JSON.parse(checkoutCall.init!.body as string)).toEqual({
      orgId: "org-1",
      plan: "club_large",
    });
    expect(toastInfo).toHaveBeenCalled();
    expect(window.location.href).toBe("https://checkout.stripe.com/c/pay/abc");
  });

  it("surfaces a non-recognised start-trial error via toast and does not navigate", async () => {
    installFetch({
      "/api/billing/start-trial": () =>
        new Response(JSON.stringify({ error: "subscription_exists" }), {
          status: 400,
        }),
    });

    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    const user = userEvent.setup();
    const smallCol = screen.getByTestId("pricing-column-club_small");
    await user.click(
      within(smallCol).getByRole("button", { name: /start 90-day free trial/i }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ── Free owner with trial consumed → Subscribe ────────────────────────────────

describe("PlanTabClient — checkout CTA (free owner, trial already used)", () => {
  function trialUsed(): OrgPlanData {
    return baseOrgPlan({
      // trial_ends_at is the "trial consumed" gate per spec, regardless of
      // whether the org is currently free (downgraded) or never-trialed-but-
      // legacy-backfilled.
      trialEndsAt: "2026-02-01T00:00:00.000Z",
    });
  }

  it("renders 'Subscribe to ...' buttons in place of trial CTAs", () => {
    render(<PlanTabClient orgPlan={trialUsed()} />);
    expect(
      screen.getByRole("button", { name: /subscribe to club small/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /subscribe to club large/i }),
    ).toBeTruthy();
    // The trial CTA must NOT appear — that's the whole point of the gate.
    expect(
      screen.queryByRole("button", { name: /start 90-day free trial/i }),
    ).toBeNull();
  });

  it("POSTs to /api/billing/create-checkout with the picked tier and redirects to the Stripe URL", async () => {
    const { calls } = installFetch({
      "/api/billing/create-checkout": () =>
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/pay/large" }),
          { status: 200 },
        ),
    });

    render(<PlanTabClient orgPlan={trialUsed()} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /subscribe to club large/i }),
    );

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://checkout.stripe.com/c/pay/large",
      ),
    );

    const call = calls.find((c) => c.url === "/api/billing/create-checkout")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({
      orgId: "org-1",
      plan: "club_large",
    });
  });
});

// ── Trialing → days remaining + Add payment method ────────────────────────────

describe("PlanTabClient — trial banner", () => {
  it("shows 'X days remaining' with plural form and Add payment method CTA", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_small",
          subscriptionStatus: "trialing",
          teamLimit: 10,
          trialEndsAt: "2026-08-19T00:00:00.000Z",
          trialDaysRemaining: 87,
        })}
      />,
    );

    expect(screen.getByText(/87 days remaining/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /add payment method/i }),
    ).toBeTruthy();
  });

  it("shows '1 day remaining' (singular) when one day left — sub-24h trial", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_large",
          subscriptionStatus: "trialing",
          teamLimit: null,
          trialEndsAt: "2026-05-22T00:00:00.000Z",
          trialDaysRemaining: 1,
        })}
      />,
    );
    // The exact phrase "1 day remaining" — would fail on a stale "1 days".
    expect(screen.getByText(/1 day remaining/)).toBeTruthy();
    expect(screen.queryByText(/1 days remaining/)).toBeNull();
  });

  it("POSTs to /api/billing/create-setup and redirects to the Stripe setup URL", async () => {
    const { calls } = installFetch({
      "/api/billing/create-setup": () =>
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/setup/xyz" }),
          { status: 200 },
        ),
    });

    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_small",
          subscriptionStatus: "trialing",
          teamLimit: 10,
          trialEndsAt: "2026-08-19T00:00:00.000Z",
          trialDaysRemaining: 30,
        })}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add payment method/i }));

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://checkout.stripe.com/c/setup/xyz",
      ),
    );

    const call = calls.find((c) => c.url === "/api/billing/create-setup")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ orgId: "org-1" });
  });
});

// ── Active / past_due → Manage billing link ──────────────────────────────────

describe("PlanTabClient — active/past_due banner", () => {
  it("active club org shows 'Manage billing' link pointing to /dashboard/club/billing", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_large",
          subscriptionStatus: "active",
          teamLimit: null,
          trialEndsAt: "2026-02-01T00:00:00.000Z",
          hasStripeSubscription: true,
        })}
      />,
    );

    const link = screen.getByRole("link", { name: /manage billing/i });
    expect(link.getAttribute("href")).toBe("/dashboard/club/billing");
  });

  it("past_due club org shows the failed-payment hint", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_small",
          subscriptionStatus: "past_due",
          teamLimit: 10,
          trialEndsAt: "2026-02-01T00:00:00.000Z",
          hasStripeSubscription: true,
        })}
      />,
    );

    expect(screen.getByText(/payment failed/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /manage billing/i }).getAttribute("href"),
    ).toBe("/dashboard/club/billing");
  });

  it("on an already-paid tier, switching to the other club tier shows a 'Change plan' link to billing instead of a self-serve CTA", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_small",
          subscriptionStatus: "active",
          teamLimit: 10,
          trialEndsAt: "2026-02-01T00:00:00.000Z",
          hasStripeSubscription: true,
        })}
      />,
    );

    const largeCol = screen.getByTestId("pricing-column-club_large");
    const changeLink = within(largeCol).getByRole("link", {
      name: /change plan/i,
    });
    expect(changeLink.getAttribute("href")).toBe("/dashboard/club/billing");
  });
});

// ── Non-owner ─────────────────────────────────────────────────────────────────

describe("PlanTabClient — non-owner views", () => {
  it("director on a free org sees a 'contact owner' notice, no CTAs", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({ orgRole: "director" })}
      />,
    );

    expect(screen.getByText(/contact your organization owner/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /start 90-day free trial/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add payment method/i }),
    ).toBeNull();
  });

  it("director on a club org sees the current-plan label with the owner-only notice", () => {
    render(
      <PlanTabClient
        orgPlan={baseOrgPlan({
          plan: "club_large",
          subscriptionStatus: "active",
          teamLimit: null,
          trialEndsAt: "2026-02-01T00:00:00.000Z",
          hasStripeSubscription: true,
          orgRole: "director",
        })}
      />,
    );

    expect(
      screen.getByText(/your organization is on club large/i),
    ).toBeTruthy();
    expect(screen.getByText(/only the organization owner/i)).toBeTruthy();
  });
});

// ── No active team ────────────────────────────────────────────────────────────

describe("PlanTabClient — no orgPlan (no active team)", () => {
  it("shows the create-team prompt instead of pricing columns", () => {
    render(<PlanTabClient orgPlan={null} />);

    expect(screen.getByText(/no team yet/i)).toBeTruthy();
    expect(screen.getByText(/create a team first/i)).toBeTruthy();
    // No pricing comparison rendered when there is nothing to upgrade.
    expect(screen.queryByTestId("pricing-column-free")).toBeNull();
  });
});

// ── Admin upgrade dialog ──────────────────────────────────────────────────────

describe("PlanTabClient — admin-code path", () => {
  it("opens the access-code dialog and POSTs /api/admin/upgrade with tier + code", async () => {
    const { calls } = installFetch({
      "/api/admin/upgrade": () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /enter access code/i }));

    // Dialog content is portaled; querying within document is fine because
    // jsdom shares a single body.
    // Exact string match — the dialog itself also has accessible-name "Enter
    // access code" via aria-labelledby, and a /access code/i regex matches
    // both.
    const codeInput = await screen.findByLabelText("Access code");
    await user.type(codeInput, "secret-code");
    await user.click(screen.getByRole("button", { name: /confirm upgrade/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const call = calls.find((c) => c.url === "/api/admin/upgrade")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({
      orgId: "org-1",
      // default tier is club_large per the component's initial state.
      plan: "club_large",
      code: "secret-code",
    });
  });

  it("invalid_code → 'Invalid code.' toast, no refresh", async () => {
    installFetch({
      "/api/admin/upgrade": () =>
        new Response(JSON.stringify({ error: "invalid_code" }), {
          status: 403,
        }),
    });

    render(<PlanTabClient orgPlan={baseOrgPlan()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /enter access code/i }));
    await user.type(await screen.findByLabelText("Access code"), "wrong");
    await user.click(screen.getByRole("button", { name: /confirm upgrade/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Invalid code."),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
