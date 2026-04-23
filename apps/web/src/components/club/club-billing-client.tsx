"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
};

export function ClubBillingClient({
  org,
}: {
  org: {
    id: string;
    plan: string | null;
    subscriptionStatus: string | null;
    stripeSubscriptionId: string | null;
  };
}) {
  const [loading, setLoading] = useState(false);

  async function handlePortal() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to open billing portal");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  const statusLabel = org.subscriptionStatus
    ? (STATUS_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus)
    : null;

  const statusVariant =
    org.subscriptionStatus === "active" || org.subscriptionStatus === "trialing"
      ? ("outline" as const)
      : ("destructive" as const);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Billing</h1>

      <div className="rounded-lg border p-6 space-y-4 max-w-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Plan</span>
          <span className="font-semibold capitalize">{org.plan ?? "Free"}</span>
        </div>

        {statusLabel && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Status</span>
            <Badge
              variant={statusVariant}
              className={
                org.subscriptionStatus === "active"
                  ? "text-green-600 border-green-200 bg-green-50"
                  : org.subscriptionStatus === "trialing"
                  ? "text-blue-600 border-blue-200 bg-blue-50"
                  : undefined
              }
            >
              {statusLabel}
            </Badge>
          </div>
        )}

        {org.stripeSubscriptionId && (
          <div className="pt-2">
            <Button onClick={handlePortal} disabled={loading} className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              {loading ? "Opening…" : "Manage subscription"}
            </Button>
            <p className="mt-2 text-xs text-center text-muted-foreground">
              Update payment method, view invoices, or cancel your plan.
            </p>
          </div>
        )}

        {!org.stripeSubscriptionId && (
          <p className="text-sm text-muted-foreground pt-2">
            No active subscription found. Contact support if you believe this is an error.
          </p>
        )}
      </div>
    </div>
  );
}
