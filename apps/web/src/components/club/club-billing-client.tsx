"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreditCard, ExternalLink, FileText, RotateCcw, XCircle } from "lucide-react";
import { isClubPlan } from "@/lib/plan";

/**
 * Club Billing page — owner-only billing dashboard.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Club Billing Page"
 *
 * State matrix (drives the badge + message at the top of the page):
 *
 *   subscription_status = 'trialing'                                  → Trial
 *   active + pending_plan = null + subscription_cancel_at = null      → Active
 *   active + pending_plan = 'club_small'                              → Downgrading
 *   active + subscription_cancel_at IS NOT NULL                       → Canceling
 *   past_due                                                          → Past Due
 *   canceled                                                          → Canceled
 *
 * Action buttons appear based on DB state per the spec:
 *
 *   "Add payment method"        — trialing (POST /api/billing/create-setup → Stripe setup session)
 *   "Manage payment method"     — stripe_subscription_id IS NOT NULL AND status != 'canceled'
 *                                 (POST /api/billing/portal → Stripe portal, payment-method + history only)
 *   "Cancel plan"               — active + sub id + cancel_at IS NULL + pending_plan IS NULL
 *                                 (POST /api/billing/cancel — in-app, NOT via portal, so the
 *                                 "Canceling" badge + Reactivate flow works)
 *   "Reactivate"                — Canceling state (POST /api/billing/reactivate)
 *   "Update payment method"     — Past Due state (same portal route as Manage)
 *   Billing history link        — stripe_subscription_id IS NOT NULL (portal)
 *
 * Managed account: when stripe_subscription_id IS NULL AND status = 'active'
 * (admin/pilot upgrades), no subscription-management buttons render — only a
 * "Managed account — contact us to make changes." note. Cancellation/portal
 * for these orgs has no Stripe object to act on.
 */

export type ClubBillingOrg = {
  id: string;
  plan: string | null;
  subscriptionStatus: string | null;
  teamLimit: number | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  pendingPlan: string | null;
  pendingPlanAt: string | null;
  subscriptionCancelAt: string | null;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
};

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  club_small: "Club Small",
  club_large: "Club Large",
};

function planLabel(plan: string | null): string {
  if (!plan) return "Free";
  return PLAN_LABELS[plan] ?? plan;
}

type BadgeState =
  | "trial"
  | "active"
  | "downgrading"
  | "canceling"
  | "past_due"
  | "canceled"
  | "unknown";

function deriveBadgeState(org: ClubBillingOrg): BadgeState {
  if (org.subscriptionStatus === "trialing") return "trial";
  if (org.subscriptionStatus === "past_due") return "past_due";
  if (org.subscriptionStatus === "canceled") return "canceled";
  if (org.subscriptionStatus === "active") {
    if (org.subscriptionCancelAt) return "canceling";
    if (org.pendingPlan) return "downgrading";
    return "active";
  }
  return "unknown";
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
};

export function ClubBillingClient({ org }: { org: ClubBillingOrg }) {
  const router = useRouter();
  // Single in-flight token so the action buttons disable together and the
  // active button can show an action-specific spinner label.
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const badgeState = deriveBadgeState(org);

  // "Managed account": admin/pilot upgrades have plan = 'club_*' AND status =
  // 'active' but no Stripe subscription. The page should show no Stripe-backed
  // action buttons — only a contact-us note.
  const isManagedAccount =
    isClubPlan(org.plan) &&
    org.subscriptionStatus === "active" &&
    !org.hasStripeSubscription;

  async function postJson(
    url: string,
    body: Record<string, unknown>,
    busyKey: string,
  ): Promise<{ ok: boolean; data: unknown }> {
    setBusy(busyKey);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } finally {
      setBusy(null);
    }
  }

  async function handleAddPaymentMethod() {
    const { ok, data } = await postJson(
      "/api/billing/create-setup",
      { orgId: org.id },
      "setup",
    );
    if (!ok) {
      const err = (data as { error?: string }).error;
      toast.error(err ?? "Failed to start payment setup");
      return;
    }
    window.location.href = (data as { url: string }).url;
  }

  async function handlePortal(busyKey: "portal" | "portal-history" | "portal-pastdue") {
    const { ok, data } = await postJson(
      "/api/billing/portal",
      { orgId: org.id },
      busyKey,
    );
    if (!ok) {
      const err = (data as { error?: string }).error;
      toast.error(err ?? "Failed to open billing portal");
      return;
    }
    window.location.href = (data as { url: string }).url;
  }

  async function handleCancelConfirmed() {
    setConfirmCancelOpen(false);
    const { ok, data } = await postJson(
      "/api/billing/cancel",
      { orgId: org.id },
      "cancel",
    );
    if (!ok) {
      const err = (data as { error?: string }).error;
      toast.error(err ?? "Failed to cancel subscription");
      return;
    }
    toast.success(
      "Cancellation scheduled — you have full access until the end of the period.",
    );
    router.refresh();
  }

  async function handleReactivate() {
    const { ok, data } = await postJson(
      "/api/billing/reactivate",
      { orgId: org.id },
      "reactivate",
    );
    if (!ok) {
      const err = (data as { error?: string }).error;
      toast.error(err ?? "Failed to reactivate subscription");
      return;
    }
    toast.success("Your subscription is reactivated.");
    router.refresh();
  }

  // ── Render helpers ──────────────────────────────────────────────────────

  function StatusBadge() {
    const variants: Record<
      BadgeState,
      { label: string; className: string }
    > = {
      trial: {
        label: "Trial",
        className: "border-blue-200 bg-blue-50 text-blue-700",
      },
      active: {
        label: "Active",
        className: "border-green-200 bg-green-50 text-green-700",
      },
      downgrading: {
        label: "Downgrading",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      },
      canceling: {
        label: "Canceling",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      },
      past_due: {
        label: "Past Due",
        className: "border-red-200 bg-red-50 text-red-700",
      },
      canceled: {
        label: "Canceled",
        className: "border-gray-200 bg-gray-50 text-gray-700",
      },
      unknown: { label: "—", className: "" },
    };
    const v = variants[badgeState];
    return (
      <Badge
        data-testid="billing-status-badge"
        variant="outline"
        className={v.className}
      >
        {v.label}
      </Badge>
    );
  }

  // Message + per-state inline actions (Reactivate / Update payment method)
  function StateMessage() {
    if (badgeState === "trial" && org.trialEndsAt) {
      return (
        <p className="text-sm text-muted-foreground">
          Your trial ends on{" "}
          <LocalTime isoString={org.trialEndsAt} options={DATE_OPTS} /> —{" "}
          {org.trialDaysRemaining ?? 0}{" "}
          {org.trialDaysRemaining === 1 ? "day" : "days"} remaining.
        </p>
      );
    }
    if (badgeState === "downgrading" && org.pendingPlanAt) {
      return (
        <p className="text-sm text-muted-foreground">
          Your plan will change to {planLabel(org.pendingPlan)} on{" "}
          <LocalTime isoString={org.pendingPlanAt} options={DATE_OPTS} />.
          You&apos;ll retain {planLabel(org.plan)} access until then.
        </p>
      );
    }
    if (badgeState === "canceling" && org.subscriptionCancelAt) {
      return (
        <p className="text-sm text-muted-foreground">
          Your plan will be canceled on{" "}
          <LocalTime
            isoString={org.subscriptionCancelAt}
            options={DATE_OPTS}
          />
          . You have full access until then.
        </p>
      );
    }
    if (badgeState === "past_due") {
      return (
        <p className="text-sm text-red-700">
          Payment failed — please update your payment method.
        </p>
      );
    }
    if (badgeState === "canceled") {
      return (
        <p className="text-sm text-muted-foreground">
          Your subscription has ended.
        </p>
      );
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Billing</h1>

      <div className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              Current plan
            </p>
            <p className="text-xl font-semibold">{planLabel(org.plan)}</p>
          </div>
          <StatusBadge />
        </div>

        <StateMessage />

        {/* Canceling state — inline Reactivate button (spec's "Canceling" row
            calls this out explicitly). */}
        {badgeState === "canceling" && (
          <Button
            onClick={handleReactivate}
            disabled={busy !== null}
            variant="outline"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {busy === "reactivate" ? "Reactivating…" : "Reactivate"}
          </Button>
        )}

        {/* Past Due state — inline "Update payment method" → portal (spec). */}
        {badgeState === "past_due" && org.hasStripeSubscription && (
          <Button
            onClick={() => handlePortal("portal-pastdue")}
            disabled={busy !== null}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            {busy === "portal-pastdue" ? "Opening…" : "Update payment method"}
          </Button>
        )}
      </div>

      {/* Managed account note — no subscription-management buttons. */}
      {isManagedAccount && (
        <div
          className="rounded-lg border p-6"
          data-testid="managed-account-note"
        >
          <p className="font-semibold">Managed account</p>
          <p className="text-sm text-muted-foreground mt-1">
            Managed account — contact us to make changes.
          </p>
        </div>
      )}

      {/* Subscription-management actions. Hidden entirely for managed accounts
          (those have no Stripe object to act on) and for the canceled state
          (no portal access once status='canceled'). */}
      {!isManagedAccount && badgeState !== "canceled" && (
        <div className="rounded-lg border p-6 space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            Manage subscription
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {/* Add payment method — trialing only. */}
            {badgeState === "trial" && (
              <Button onClick={handleAddPaymentMethod} disabled={busy !== null}>
                <CreditCard className="mr-2 h-4 w-4" />
                {busy === "setup" ? "Opening…" : "Add payment method"}
              </Button>
            )}

            {/* Manage payment method — Stripe portal. Visible whenever a sub
                exists and status is not canceled. Hidden in past_due since the
                inline "Update payment method" already covers that. */}
            {org.hasStripeSubscription && badgeState !== "past_due" && (
              <Button
                onClick={() => handlePortal("portal")}
                disabled={busy !== null}
                variant="outline"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {busy === "portal" ? "Opening…" : "Manage payment method"}
              </Button>
            )}

            {/* Billing history link → portal. */}
            {org.hasStripeSubscription && (
              <Button
                onClick={() => handlePortal("portal-history")}
                disabled={busy !== null}
                variant="outline"
              >
                <FileText className="mr-2 h-4 w-4" />
                {busy === "portal-history" ? "Opening…" : "Billing history"}
              </Button>
            )}

            {/* Cancel plan — only in the pure "Active" state. Excluded for
                trial (cancel uses a different flow), canceling (already
                pending), downgrading (mutually exclusive with cancel per the
                cancel route's pending_plan_change guard), past_due, canceled. */}
            {badgeState === "active" && org.hasStripeSubscription && (
              <Button
                onClick={() => setConfirmCancelOpen(true)}
                disabled={busy !== null}
                variant="destructive"
              >
                <XCircle className="mr-2 h-4 w-4" />
                {busy === "cancel" ? "Canceling…" : "Cancel plan"}
              </Button>
            )}
          </div>

          {org.hasStripeSubscription && (
            <p className="text-xs text-muted-foreground">
              Plan changes (between Club Small and Club Large) are handled in
              the app — visit the{" "}
              <a
                className="underline underline-offset-2"
                href="/dashboard/settings?tab=plan"
              >
                Plan tab
              </a>{" "}
              to switch tiers.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Need help? Contact{" "}
        <a
          className="underline underline-offset-2"
          href="mailto:support@lista.team"
        >
          support@lista.team
        </a>
        .
      </p>

      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll keep full access to {planLabel(org.plan)} until the
              end of your current billing period. After that, your club will
              move to Free (1 team, Lista branding).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCancelOpen(false)}
              disabled={busy !== null}
            >
              Keep subscription
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirmed}
              disabled={busy !== null}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {busy === "cancel" ? "Canceling…" : "Cancel subscription"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
