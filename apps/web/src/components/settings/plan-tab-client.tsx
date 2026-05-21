"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Check, ExternalLink } from "lucide-react";
import { isClubPlan } from "@/lib/plan";

/**
 * Plan tab — pricing comparison and self-serve upgrade UI.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "UI Requirements →
 * Pricing / Upgrade Page" and "Upgrade Entry Points".
 *
 * Three-column comparison (Free | Club Small | Club Large) with the current
 * plan highlighted. CTAs depend on the org's state:
 *
 *   Free owner, trial not yet consumed  → "Start 90-day free trial" on each
 *                                          club tier → POST /api/billing/start-trial
 *                                          → /dashboard/club
 *   Free owner, trial already consumed  → "Subscribe" on each club tier →
 *                                          POST /api/billing/create-checkout
 *                                          → Stripe checkout
 *   Trialing                            → top banner with days remaining +
 *                                          "Add payment method" → POST
 *                                          /api/billing/create-setup
 *   Active / past_due                   → top banner with link to Club Billing
 *   Non-owner                           → "contact owner" notice (no CTAs)
 *
 * The admin-code path is retained as a secondary entry point at the bottom for
 * pilot programs / Lista-support-driven upgrades (gated by ADMIN_UPGRADE_CODE).
 *
 * `trial_ends_at != null` is the "trial already consumed" gate per spec —
 * `start-trial` will return `trial_already_used`, and the UI catches that and
 * falls back to checkout automatically so the user lands somewhere useful.
 */

type Tier = "free" | "club_small" | "club_large";

export type OrgPlanData = {
  id: string;
  plan: string | null;
  subscriptionStatus: string | null;
  teamLimit: number | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  pendingPlan: string | null;
  subscriptionCancelAt: string | null;
  hasStripeSubscription: boolean;
  orgRole: string | null;
};

const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  club_small: "Club Small",
  club_large: "Club Large",
};

const TIER_PRICES: Record<Tier, string> = {
  free: "$0",
  club_small: "$99",
  club_large: "$299",
};

const TIER_FEATURES: Record<Tier, string[]> = {
  free: ["1 team", "Lista branding"],
  club_small: [
    "Up to 10 teams",
    "Custom branding",
    "Custom subdomain",
    "90-day free trial",
  ],
  club_large: [
    "Unlimited teams",
    "Custom branding",
    "Custom subdomain",
    "Custom domain",
    "90-day free trial",
  ],
};

function tierFromPlan(plan: string | null): Tier {
  // Legacy 'club' and unknown values fall back to 'free' for display purposes;
  // the migration backfilled all 'club' rows to 'club_large' so this is purely
  // defensive (and avoids the column lighting up multiple "Current" badges).
  if (plan === "free" || plan === "club_small" || plan === "club_large") {
    return plan;
  }
  return "free";
}

export function PlanTabClient({ orgPlan }: { orgPlan: OrgPlanData | null }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adminPlan, setAdminPlan] = useState<"club_small" | "club_large">(
    "club_large",
  );
  const [adminCode, setAdminCode] = useState("");
  // Single in-flight token so two CTAs can't both disable each other and so the
  // button label can show the action-specific spinner text.
  const [busy, setBusy] = useState<string | null>(null);

  const currentPlan = tierFromPlan(orgPlan?.plan ?? null);
  const isOwner = orgPlan?.orgRole === "owner";
  const isTrialing = orgPlan?.subscriptionStatus === "trialing";
  const isActive = orgPlan?.subscriptionStatus === "active";
  const isPastDue = orgPlan?.subscriptionStatus === "past_due";
  // `trial_ends_at != null` is the permanent "trial consumed" marker per spec
  // — it covers both an actual prior trial AND the legacy-club backfill that
  // pre-marked pre-existing club orgs as ineligible.
  const trialAlreadyUsed = orgPlan?.trialEndsAt != null;

  // ── Action handlers ──────────────────────────────────────────────────────

  async function startTrial(plan: "club_small" | "club_large") {
    if (!orgPlan || !isOwner) return;
    setBusy(`trial-${plan}`);
    try {
      const res = await fetch("/api/billing/start-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: orgPlan.id, plan }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        if (error === "trial_already_used") {
          // Spec: trial-ineligible orgs are routed to checkout. Surface a hint
          // before silently switching to checkout so the user understands why.
          toast.info("Trial already used — sending you to checkout.");
          await startCheckout(plan);
          return;
        }
        toast.error(error ?? "Failed to start trial");
        return;
      }
      toast.success("Trial started — welcome to Lista Club!");
      router.push("/dashboard/club");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function startCheckout(plan: "club_small" | "club_large") {
    if (!orgPlan || !isOwner) return;
    setBusy(`checkout-${plan}`);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: orgPlan.id, plan }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to open checkout");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  async function addPaymentMethod() {
    if (!orgPlan || !isOwner) return;
    setBusy("setup");
    try {
      const res = await fetch("/api/billing/create-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: orgPlan.id }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to open setup");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  async function handleAdminUpgrade(e: React.FormEvent) {
    e.preventDefault();
    if (!orgPlan || !adminCode.trim()) return;
    setBusy("admin");
    try {
      const res = await fetch("/api/admin/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: orgPlan.id,
          plan: adminPlan,
          code: adminCode.trim(),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        if (error === "invalid_code") toast.error("Invalid code.");
        else if (error === "not_available") toast.error("Upgrade not available.");
        else toast.error(error ?? "Upgrade failed.");
        return;
      }
      toast.success(`Upgraded to ${TIER_LABELS[adminPlan]}!`);
      setDialogOpen(false);
      setAdminCode("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // ── Edge cases ───────────────────────────────────────────────────────────

  // User has no active team yet → they cannot start a trial (a team is required
  // to derive the org). Direct them to create one.
  if (!orgPlan) {
    return (
      <div className="rounded-lg border p-6 max-w-md space-y-2">
        <p className="font-semibold">No team yet</p>
        <p className="text-sm text-muted-foreground">
          Create a team first, then come back here to start a Club trial or
          subscribe.
        </p>
      </div>
    );
  }

  // Non-owner on the org (director / coach) — billing changes require owner.
  if (!isOwner) {
    return (
      <div className="rounded-lg border p-6 max-w-md space-y-2">
        <p className="font-semibold">{TIER_LABELS[currentPlan]} plan</p>
        <p className="text-sm text-muted-foreground">
          {isClubPlan(orgPlan.plan)
            ? `Your organization is on ${TIER_LABELS[currentPlan]}. Only the organization owner can change billing settings.`
            : "Contact your organization owner to upgrade your plan."}
        </p>
      </div>
    );
  }

  // ── Owner view ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Trial banner — top of page so the days-remaining + add-payment CTA
          is the first thing a trialing owner sees. */}
      {isTrialing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-blue-900">
              Trial active —{" "}
              {orgPlan.trialDaysRemaining != null
                ? `${orgPlan.trialDaysRemaining} day${orgPlan.trialDaysRemaining === 1 ? "" : "s"} remaining`
                : "in progress"}
            </p>
            <p className="text-sm text-blue-800">
              Add a payment method now to keep your club after the trial ends.
            </p>
          </div>
          <Button onClick={addPaymentMethod} disabled={busy !== null}>
            {busy === "setup" ? "Opening…" : "Add payment method"}
          </Button>
        </div>
      )}

      {/* Active / past-due banner — points the owner at the billing page for
          plan changes, cancellation, and payment method management. */}
      {(isActive || isPastDue) && (
        <div className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold">
              You&apos;re on {TIER_LABELS[currentPlan]}.
            </p>
            <p className="text-sm text-muted-foreground">
              {isPastDue
                ? "Payment failed — update your payment method on the billing page to keep access."
                : "Manage your subscription, payment method, and invoices on the billing page."}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard/club/billing">
              <ExternalLink className="mr-2 h-4 w-4" />
              Manage billing
            </Link>
          </Button>
        </div>
      )}

      {/* Three-column comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(["free", "club_small", "club_large"] as const).map((tier) => (
          <PricingColumn
            key={tier}
            tier={tier}
            currentPlan={currentPlan}
            trialAlreadyUsed={trialAlreadyUsed}
            busy={busy}
            onStartTrial={startTrial}
            onStartCheckout={startCheckout}
          />
        ))}
      </div>

      {/* Secondary admin-code path — for pilot programs and Lista-support
          upgrades that bypass Stripe (gated by ADMIN_UPGRADE_CODE). */}
      <div className="pt-4 border-t">
        <p className="text-xs text-muted-foreground text-center">
          Have an access code from Lista support?{" "}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Enter access code
          </button>
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enter access code</DialogTitle>
              <DialogDescription>
                Use a code provided by Lista support to upgrade without Stripe.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdminUpgrade} className="space-y-4 pt-1">
              <div className="space-y-2">
                <Label htmlFor="admin-plan">Tier</Label>
                <select
                  id="admin-plan"
                  value={adminPlan}
                  onChange={(e) =>
                    setAdminPlan(e.target.value as "club_small" | "club_large")
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="club_small">Club Small</option>
                  <option value="club_large">Club Large</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="upgrade-code">Access code</Label>
                <Input
                  id="upgrade-code"
                  type="password"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  placeholder="Enter code"
                  autoComplete="off"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={busy === "admin"}
              >
                {busy === "admin" ? "Upgrading…" : "Confirm upgrade"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function PricingColumn({
  tier,
  currentPlan,
  trialAlreadyUsed,
  busy,
  onStartTrial,
  onStartCheckout,
}: {
  tier: Tier;
  currentPlan: Tier;
  trialAlreadyUsed: boolean;
  busy: string | null;
  onStartTrial: (plan: "club_small" | "club_large") => void;
  onStartCheckout: (plan: "club_small" | "club_large") => void;
}) {
  const isCurrent = tier === currentPlan;

  return (
    <div
      data-testid={`pricing-column-${tier}`}
      className={`rounded-lg border p-4 space-y-4 ${
        isCurrent ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{TIER_LABELS[tier]}</p>
          {isCurrent && <Badge variant="default">Current</Badge>}
        </div>
        <p className="text-2xl font-bold">
          {TIER_PRICES[tier]}
          {tier !== "free" && (
            <span className="text-sm font-normal text-muted-foreground">
              /mo
            </span>
          )}
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        {TIER_FEATURES[tier].map((feat) => (
          <li key={feat} className="flex items-start gap-2">
            <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <PricingCTA
        tier={tier}
        currentPlan={currentPlan}
        trialAlreadyUsed={trialAlreadyUsed}
        busy={busy}
        onStartTrial={onStartTrial}
        onStartCheckout={onStartCheckout}
      />
    </div>
  );
}

function PricingCTA({
  tier,
  currentPlan,
  trialAlreadyUsed,
  busy,
  onStartTrial,
  onStartCheckout,
}: {
  tier: Tier;
  currentPlan: Tier;
  trialAlreadyUsed: boolean;
  busy: string | null;
  onStartTrial: (plan: "club_small" | "club_large") => void;
  onStartCheckout: (plan: "club_small" | "club_large") => void;
}) {
  if (tier === currentPlan) {
    return (
      <p className="text-xs text-center text-muted-foreground">
        Your current plan
      </p>
    );
  }

  // Free is never a self-serve target — downgrades happen on the billing page
  // via the cancel flow.
  if (tier === "free") {
    return (
      <p className="text-xs text-center text-muted-foreground">
        Downgrade from billing page
      </p>
    );
  }

  // Tier switching between club tiers (e.g. small → large mid-trial) lives on
  // the Club Billing page — those routes have richer in-app downgrade UX with
  // schedule visibility, team-count warnings, etc.
  if (currentPlan !== "free") {
    return (
      <Button asChild variant="outline" className="w-full">
        <Link href="/dashboard/club/billing">Change plan</Link>
      </Button>
    );
  }

  // Free → club_small or club_large: trial unless the org has already
  // consumed its trial, in which case fall straight through to checkout.
  const tierPlan = tier as "club_small" | "club_large";

  if (trialAlreadyUsed) {
    const label =
      busy === `checkout-${tierPlan}` ? "Opening…" : `Subscribe to ${TIER_LABELS[tier]}`;
    return (
      <Button
        className="w-full"
        onClick={() => onStartCheckout(tierPlan)}
        disabled={busy !== null}
      >
        {label}
      </Button>
    );
  }

  const label =
    busy === `trial-${tierPlan}` ? "Starting…" : "Start 90-day free trial";
  return (
    <Button
      className="w-full"
      onClick={() => onStartTrial(tierPlan)}
      disabled={busy !== null}
    >
      {label}
    </Button>
  );
}
