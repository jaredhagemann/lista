"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Zap, Building2, Users, Palette } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
};

type OrgPlan = {
  id: string;
  plan: string | null;
  subscriptionStatus: string | null;
  orgRole: string | null;
};

export function PlanTabClient({ orgPlan }: { orgPlan: OrgPlan | null }) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const isClub = orgPlan?.plan === "club";
  const isOwner = orgPlan?.orgRole === "owner";

  async function handleUpgrade() {
    if (!orgPlan) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: orgPlan.id }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error === "already_subscribed" ? "Already subscribed to Club." : (error ?? "Failed to start checkout"));
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (isClub && orgPlan) {
    // Club subscriber — show status and portal link for owners
    const statusLabel = orgPlan.subscriptionStatus
      ? (STATUS_LABELS[orgPlan.subscriptionStatus] ?? orgPlan.subscriptionStatus)
      : null;
    const isActive =
      orgPlan.subscriptionStatus === "active" ||
      orgPlan.subscriptionStatus === "trialing";

    return (
      <div className="space-y-4">
        <div className="rounded-lg border p-6 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Current plan</span>
            <span className="font-semibold">Club</span>
          </div>
          {statusLabel && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              <Badge
                variant={isActive ? "outline" : "secondary"}
                className={isActive ? "text-green-600 border-green-200 bg-green-50" : undefined}
              >
                {statusLabel}
              </Badge>
            </div>
          )}
        </div>
        {isOwner && (
          <Button asChild variant="outline">
            <Link href="/dashboard/club/billing">
              <ExternalLink className="mr-2 h-4 w-4" />
              Manage billing
            </Link>
          </Button>
        )}
      </div>
    );
  }

  if (orgPlan && !isClub && !isOwner) {
    // Director on a free-tier org — can't upgrade themselves
    return (
      <div className="rounded-lg border p-6 space-y-2 max-w-md">
        <p className="font-semibold">Free plan</p>
        <p className="text-sm text-muted-foreground">
          Contact your organization owner to upgrade to Club.
        </p>
      </div>
    );
  }

  // Free-tier owner (or no org) — show upgrade CTA
  return (
    <div className="space-y-6 max-w-md">
      <div className="rounded-lg border p-6 space-y-2">
        <p className="font-semibold">Free plan</p>
        <p className="text-sm text-muted-foreground">
          You&apos;re on the free plan. Upgrade to Club to unlock multi-team
          management and white-label branding for your organization.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-6 space-y-4">
        <div className="space-y-1">
          <p className="font-semibold text-lg">Club</p>
          <p className="text-sm text-muted-foreground">Everything you need to run a sports club.</p>
        </div>

        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary shrink-0" />
            Manage multiple teams from one portal
          </li>
          <li className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary shrink-0" />
            White-label branding with your club colors and logo
          </li>
          <li className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary shrink-0" />
            Custom subdomain (yourclub.lista.team)
          </li>
          <li className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary shrink-0" />
            Director roles and org-level member directory
          </li>
        </ul>

        {orgPlan ? (
          <Button
            className="w-full"
            onClick={handleUpgrade}
            disabled={checkoutLoading}
          >
            {checkoutLoading ? "Redirecting to checkout…" : "Upgrade to Club"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            You need to create a team before upgrading.
          </p>
        )}
      </div>
    </div>
  );
}
