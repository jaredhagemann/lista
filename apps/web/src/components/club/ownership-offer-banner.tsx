"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A director's pending offer of club ownership, shown across the club portal (BUG-013). */
export function OwnershipOfferBanner({
  transferId,
  clubName,
  fromName,
  expiresAt,
}: {
  transferId: string;
  clubName: string;
  fromName: string;
  expiresAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/club/ownership/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferId, accept }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Something went wrong");
        return;
      }
      toast.success(
        accept
          ? `You're now the owner of ${clubName}. Its billing is yours: update the card on file under Billing.`
          : "Offer declined"
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
      <p>
        <strong>{fromName}</strong> has offered you ownership of <strong>{clubName}</strong>. As owner you&apos;ll be
        responsible for the club&apos;s billing and settings, and {fromName} will stay on as a director. The offer
        expires on{" "}
        {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => respond(true)}>
          Accept ownership
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => respond(false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}
