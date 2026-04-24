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
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  const isClub = orgPlan?.plan === "club";
  const isOwner = orgPlan?.orgRole === "owner";

  async function handleAdminUpgrade(e: React.FormEvent) {
    e.preventDefault();
    if (!orgPlan || !code.trim()) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/admin/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: orgPlan.id, code: code.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        if (error === "invalid_code") {
          toast.error("Invalid code.");
        } else if (error === "not_available") {
          toast.error("Upgrade not available.");
        } else {
          toast.error(error ?? "Upgrade failed.");
        }
        return;
      }
      toast.success("Upgraded to Club!");
      setDialogOpen(false);
      setCode("");
      router.refresh();
    } finally {
      setUpgrading(false);
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
          <>
            <Button className="w-full" onClick={() => setDialogOpen(true)}>
              Upgrade to Club
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upgrade to Club</DialogTitle>
                  <DialogDescription>
                    Enter your access code to unlock Club features.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAdminUpgrade} className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <Label htmlFor="upgrade-code">Access code</Label>
                    <Input
                      id="upgrade-code"
                      type="password"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Enter code"
                      autoComplete="off"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={upgrading}>
                    {upgrading ? "Upgrading…" : "Confirm upgrade"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You need to create a team before upgrading.
          </p>
        )}
        <p className="text-xs text-muted-foreground text-center">
          Don&apos;t have an access code?{" "}
          <a href="mailto:support@lista.team" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Reach out to support@lista.team
          </a>{" "}
          for more information.
        </p>
      </div>
    </div>
  );
}
