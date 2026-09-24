"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The owner hands the club to a director (BUG-013, part 2). Nothing changes
 * until the director accepts; the offer expires after 14 days and can be
 * withdrawn until then.
 */
export function ClubOwnershipSection({
  orgId,
  directors,
  pending,
}: {
  orgId: string;
  directors: Array<{ profileId: string; name: string }>;
  pending: { id: string; toName: string; expiresAt: string } | null;
}) {
  const router = useRouter();
  const [toProfileId, setToProfileId] = useState(directors[0]?.profileId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = directors.find((d) => d.profileId === toProfileId);

  async function post(url: string, body: unknown, success: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Something went wrong");
        return;
      }
      toast.success(success);
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Ownership</h2>

      {pending ? (
        <div className="max-w-md space-y-3 rounded-md border p-4 text-sm">
          <p>
            You&apos;ve offered ownership to <strong>{pending.toName}</strong>. The offer expires on{" "}
            {new Date(pending.expiresAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            .
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => post("/api/club/ownership/cancel", { transferId: pending.id }, "Offer withdrawn")}
          >
            Withdraw offer
          </Button>
        </div>
      ) : directors.length === 0 ? (
        <p className="max-w-md text-sm text-muted-foreground">
          Ownership can only go to a director. Invite a director first to hand the club over.
        </p>
      ) : (
        <div className="max-w-md space-y-3">
          <p className="text-sm text-muted-foreground">
            Hand the club to one of its directors. They become the owner, including billing, when they accept.
          </p>
          <div className="space-y-2">
            <Label htmlFor="newOwner">New owner</Label>
            <select
              id="newOwner"
              value={toProfileId}
              onChange={(e) => setToProfileId(e.target.value)}
              className="border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
            >
              {directors.map((d) => (
                <option key={d.profileId} value={d.profileId}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={!toProfileId}>
            Offer ownership
          </Button>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer ownership to {chosen?.name}?</DialogTitle>
            <DialogDescription>
              When {chosen?.name} accepts, they become the club&apos;s owner and take over its billing. You become a
              director. The offer expires in 14 days, and you can withdraw it until it is accepted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => post("/api/club/ownership/transfer", { orgId, toProfileId }, "Offer sent")}
            >
              Send offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
