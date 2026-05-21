/**
 * Component-level tests for ClubBillingClient — the spec's
 * "Club Billing Page" UI at /dashboard/club/billing.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "UI Requirements →
 * Club Billing Page" (the state/badge/CTA matrix) and the related Testing
 * Checklist lines:
 *   - "Billing page shows 'Canceling' badge and access-until date"
 *   - "Reactivation clears subscription_cancel_at; UI returns to Active state"
 *   - "Billing page shows 'Downgrading' badge with correct date when
 *      pending_plan is set"
 *
 * Covers the full state matrix the component derives from `org`:
 *
 *   trialing       → Trial badge + days-remaining message + Add payment method
 *   active (clean) → Active badge + Manage payment method + Cancel + History
 *   active + pending_plan='club_small'    → Downgrading badge + message
 *   active + subscription_cancel_at set   → Canceling badge + Reactivate
 *   past_due       → Past Due badge + inline Update payment method (portal)
 *   canceled       → Canceled badge + no action buttons
 *   active + no stripe_subscription_id    → Managed account note (admin/pilot)
 *
 * And the per-state CTA wiring:
 *
 *   Add payment method  → POST /api/billing/create-setup  → Stripe URL
 *   Manage payment      → POST /api/billing/portal        → Stripe portal URL
 *   Update payment      → POST /api/billing/portal        → Stripe portal URL
 *   Billing history     → POST /api/billing/portal        → Stripe portal URL
 *   Cancel plan         → POST /api/billing/cancel        → router.refresh
 *   Reactivate          → POST /api/billing/reactivate    → router.refresh
 *
 * Plus the "Cancel plan" confirmation dialog gate — the destructive action
 * must require an explicit confirmation click to fire, so a stray button
 * click on the page can't terminate the subscription.
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

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import {
  ClubBillingClient,
  type ClubBillingOrg,
} from "@/components/club/club-billing-client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseOrg(overrides: Partial<ClubBillingOrg> = {}): ClubBillingOrg {
  return {
    id: "org-1",
    plan: "club_large",
    subscriptionStatus: "active",
    teamLimit: null,
    trialEndsAt: "2026-02-01T12:00:00.000Z",
    trialDaysRemaining: null,
    pendingPlan: null,
    pendingPlanAt: null,
    subscriptionCancelAt: null,
    hasStripeCustomer: true,
    hasStripeSubscription: true,
    ...overrides,
  };
}

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
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // jsdom doesn't implement navigation; replace location with a writable shim
  // so window.location.href assignments don't throw in Stripe-redirect tests.
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
  });
});

// ── Badge state derivation ───────────────────────────────────────────────────

describe("ClubBillingClient — badge state matrix", () => {
  function badgeText(): string {
    return screen.getByTestId("billing-status-badge").textContent ?? "";
  }

  it("trialing → 'Trial' badge", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          teamLimit: 10,
          trialEndsAt: "2026-08-19T12:00:00.000Z",
          trialDaysRemaining: 87,
          hasStripeSubscription: false,
          hasStripeCustomer: false,
        })}
      />,
    );
    expect(badgeText()).toMatch(/trial/i);
  });

  it("active + clean → 'Active' badge", () => {
    render(<ClubBillingClient org={baseOrg()} />);
    expect(badgeText()).toMatch(/active/i);
  });

  it("active + pending_plan='club_small' → 'Downgrading' badge", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          pendingPlan: "club_small",
          pendingPlanAt: "2026-06-15T12:00:00.000Z",
        })}
      />,
    );
    expect(badgeText()).toMatch(/downgrading/i);
  });

  it("active + subscription_cancel_at → 'Canceling' badge", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionCancelAt: "2026-06-15T12:00:00.000Z" })}
      />,
    );
    expect(badgeText()).toMatch(/canceling/i);
  });

  it("past_due → 'Past Due' badge", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "past_due" })}
      />,
    );
    expect(badgeText()).toMatch(/past due/i);
  });

  it("canceled → 'Canceled' badge", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "canceled" })}
      />,
    );
    expect(badgeText()).toMatch(/canceled/i);
  });
});

// ── Message rendering ─────────────────────────────────────────────────────────

describe("ClubBillingClient — state messages", () => {
  it("trialing message names days remaining (plural)", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          trialDaysRemaining: 87,
        })}
      />,
    );
    expect(screen.getByText(/87 days remaining/i)).toBeTruthy();
    expect(screen.getByText(/your trial ends on/i)).toBeTruthy();
  });

  it("trialing message uses singular 'day' when 1 day remains", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          trialDaysRemaining: 1,
        })}
      />,
    );
    // Defends against the easy "1 days remaining" plurality bug.
    expect(screen.getByText(/1 day remaining/)).toBeTruthy();
    expect(screen.queryByText(/1 days remaining/)).toBeNull();
  });

  it("downgrading message names the pending plan and previous tier", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          pendingPlan: "club_small",
          pendingPlanAt: "2026-06-15T12:00:00.000Z",
        })}
      />,
    );
    expect(screen.getByText(/will change to club small/i)).toBeTruthy();
    expect(screen.getByText(/retain club large access until then/i)).toBeTruthy();
  });

  it("canceling message states 'full access until then'", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionCancelAt: "2026-06-15T12:00:00.000Z" })}
      />,
    );
    expect(screen.getByText(/will be canceled on/i)).toBeTruthy();
    expect(screen.getByText(/full access until then/i)).toBeTruthy();
  });

  it("past_due message prompts payment-method update", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "past_due" })}
      />,
    );
    expect(screen.getByText(/payment failed/i)).toBeTruthy();
  });

  it("canceled message states the subscription has ended", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "canceled" })}
      />,
    );
    expect(screen.getByText(/your subscription has ended/i)).toBeTruthy();
  });
});

// ── CTA presence per state ───────────────────────────────────────────────────

describe("ClubBillingClient — CTA visibility matrix", () => {
  it("trialing shows 'Add payment method' + Manage + History; hides Cancel", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          trialDaysRemaining: 30,
          hasStripeSubscription: false,
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: /add payment method/i }),
    ).toBeTruthy();
    // No stripe_subscription_id yet during a trial pre-checkout — Manage/
    // History/Cancel all require a sub id and so must be hidden.
    expect(
      screen.queryByRole("button", { name: /manage payment method/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /billing history/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
  });

  it("active+clean shows Manage + Cancel + History; hides Add/Reactivate/Update", () => {
    render(<ClubBillingClient org={baseOrg()} />);
    expect(
      screen.getByRole("button", { name: /manage payment method/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /billing history/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel plan/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /add payment method/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /update payment method/i }),
    ).toBeNull();
  });

  it("downgrading hides Cancel (mutually exclusive with pending_plan per cancel route's guard)", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          pendingPlan: "club_small",
          pendingPlanAt: "2026-06-15T12:00:00.000Z",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
    // But the portal access (manage/history) is still available — the user
    // may still need to swap cards or pull invoices while a downgrade pends.
    expect(
      screen.getByRole("button", { name: /manage payment method/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /billing history/i }),
    ).toBeTruthy();
  });

  it("canceling shows Reactivate; hides Cancel", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionCancelAt: "2026-06-15T12:00:00.000Z" })}
      />,
    );
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
  });

  it("past_due shows inline 'Update payment method' and hides duplicate 'Manage' in the portal section", () => {
    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "past_due" })}
      />,
    );
    expect(
      screen.getByRole("button", { name: /update payment method/i }),
    ).toBeTruthy();
    // Spec calls for one update-PM affordance, not two — make sure the portal
    // section doesn't also surface "Manage payment method" in past_due.
    expect(
      screen.queryByRole("button", { name: /manage payment method/i }),
    ).toBeNull();
  });

  it("canceled shows no subscription-management buttons", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          subscriptionStatus: "canceled",
          // Even with a sub id still on file (Stripe records persist).
        })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /add payment method/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /manage payment method/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /billing history/i })).toBeNull();
  });
});

// ── Managed-account branch ───────────────────────────────────────────────────

describe("ClubBillingClient — managed account (admin/pilot upgrade)", () => {
  it("renders the 'Managed account' note when active club plan + no sub id", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_large",
          subscriptionStatus: "active",
          hasStripeSubscription: false,
          hasStripeCustomer: false,
        })}
      />,
    );
    const note = screen.getByTestId("managed-account-note");
    // "Managed account" appears twice (header + body); the contact prompt is
    // unique and is the load-bearing copy per the spec.
    expect(
      within(note).getByText(/contact us to make changes/i),
    ).toBeTruthy();
  });

  it("hides all subscription-management buttons for a managed account", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_large",
          subscriptionStatus: "active",
          hasStripeSubscription: false,
          hasStripeCustomer: false,
        })}
      />,
    );
    // None of the action buttons appear — the action area is replaced by the
    // managed-account note per the spec's "no subscription-management buttons"
    // requirement for admin/pilot upgrades.
    expect(
      screen.queryByRole("button", { name: /add payment method/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /manage payment method/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /billing history/i })).toBeNull();
  });
});

// ── Add payment method (trialing) ────────────────────────────────────────────

describe("ClubBillingClient — Add payment method", () => {
  it("POSTs to /api/billing/create-setup with the orgId and redirects to the Stripe URL", async () => {
    const { calls } = installFetch({
      "/api/billing/create-setup": () =>
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/setup/xyz" }),
          { status: 200 },
        ),
    });

    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          trialDaysRemaining: 30,
          hasStripeSubscription: false,
        })}
      />,
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /add payment method/i }),
    );

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://checkout.stripe.com/c/setup/xyz",
      ),
    );

    const call = calls.find((c) => c.url === "/api/billing/create-setup")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ orgId: "org-1" });
  });

  it("surfaces an error toast and does not navigate on failure", async () => {
    installFetch({
      "/api/billing/create-setup": () =>
        new Response(JSON.stringify({ error: "not_trialing" }), { status: 400 }),
    });

    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "trialing",
          trialDaysRemaining: 30,
          hasStripeSubscription: false,
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /add payment method/i }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(window.location.href).toBe("");
  });
});

// ── Portal (manage / history / past-due) ─────────────────────────────────────

describe("ClubBillingClient — portal CTAs", () => {
  it("'Manage payment method' POSTs to /api/billing/portal and redirects", async () => {
    const { calls } = installFetch({
      "/api/billing/portal": () =>
        new Response(
          JSON.stringify({ url: "https://billing.stripe.com/p/session/abc" }),
          { status: 200 },
        ),
    });

    render(<ClubBillingClient org={baseOrg()} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /manage payment method/i }),
    );

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://billing.stripe.com/p/session/abc",
      ),
    );
    const call = calls.find((c) => c.url === "/api/billing/portal")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ orgId: "org-1" });
  });

  it("'Billing history' POSTs to the same portal route", async () => {
    const { calls } = installFetch({
      "/api/billing/portal": () =>
        new Response(
          JSON.stringify({ url: "https://billing.stripe.com/p/session/hist" }),
          { status: 200 },
        ),
    });

    render(<ClubBillingClient org={baseOrg()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /billing history/i }));

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://billing.stripe.com/p/session/hist",
      ),
    );
    expect(calls.filter((c) => c.url === "/api/billing/portal")).toHaveLength(1);
  });

  it("past_due → 'Update payment method' POSTs the portal route", async () => {
    const { calls } = installFetch({
      "/api/billing/portal": () =>
        new Response(
          JSON.stringify({ url: "https://billing.stripe.com/p/session/pd" }),
          { status: 200 },
        ),
    });

    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionStatus: "past_due" })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /update payment method/i }),
    );

    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://billing.stripe.com/p/session/pd",
      ),
    );
    expect(calls.filter((c) => c.url === "/api/billing/portal")).toHaveLength(1);
  });
});

// ── Cancel plan (with confirmation gate) ─────────────────────────────────────

describe("ClubBillingClient — Cancel plan", () => {
  it("clicking 'Cancel plan' opens the confirmation dialog without firing the cancel route", async () => {
    const { calls } = installFetch({
      "/api/billing/cancel": () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    render(<ClubBillingClient org={baseOrg()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancel plan/i }));

    // Dialog title appears (portaled to body).
    expect(await screen.findByText(/cancel your subscription\?/i)).toBeTruthy();
    // No request has fired yet — the destructive action is gated behind the
    // explicit "Cancel subscription" button inside the dialog.
    expect(calls.find((c) => c.url === "/api/billing/cancel")).toBeUndefined();
  });

  it("confirming the dialog POSTs /api/billing/cancel and triggers router.refresh", async () => {
    const { calls } = installFetch({
      "/api/billing/cancel": () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    render(<ClubBillingClient org={baseOrg()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancel plan/i }));
    // Click the confirmation button inside the dialog.
    await user.click(
      await screen.findByRole("button", { name: /cancel subscription/i }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/billing/cancel")).toBeDefined(),
    );
    const call = calls.find((c) => c.url === "/api/billing/cancel")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ orgId: "org-1" });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("surfaces server error and does not refresh on cancel failure", async () => {
    installFetch({
      "/api/billing/cancel": () =>
        new Response(
          JSON.stringify({ error: "already_canceling" }),
          { status: 400 },
        ),
    });

    render(<ClubBillingClient org={baseOrg()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancel plan/i }));
    await user.click(
      await screen.findByRole("button", { name: /cancel subscription/i }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ── Reactivate ───────────────────────────────────────────────────────────────

describe("ClubBillingClient — Reactivate", () => {
  it("POSTs /api/billing/reactivate and refreshes on success", async () => {
    const { calls } = installFetch({
      "/api/billing/reactivate": () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionCancelAt: "2026-06-15T12:00:00.000Z" })}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reactivate/i }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.url === "/api/billing/reactivate"),
      ).toBeDefined(),
    );
    const call = calls.find((c) => c.url === "/api/billing/reactivate")!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ orgId: "org-1" });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("error response surfaces toast and skips refresh", async () => {
    installFetch({
      "/api/billing/reactivate": () =>
        new Response(JSON.stringify({ error: "not_canceling" }), {
          status: 400,
        }),
    });

    render(
      <ClubBillingClient
        org={baseOrg({ subscriptionCancelAt: "2026-06-15T12:00:00.000Z" })}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reactivate/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ── Current plan label ───────────────────────────────────────────────────────

describe("ClubBillingClient — current plan label", () => {
  it("shows 'Club Large' for plan='club_large'", () => {
    render(<ClubBillingClient org={baseOrg()} />);
    expect(screen.getByText("Club Large")).toBeTruthy();
  });

  it("shows 'Club Small' for plan='club_small'", () => {
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: "club_small",
          subscriptionStatus: "active",
          teamLimit: 10,
        })}
      />,
    );
    expect(screen.getByText("Club Small")).toBeTruthy();
  });

  it("shows 'Free' for plan=null", () => {
    // Edge: canceled orgs still render this page until they navigate away.
    render(
      <ClubBillingClient
        org={baseOrg({
          plan: null,
          subscriptionStatus: "canceled",
        })}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
  });
});
