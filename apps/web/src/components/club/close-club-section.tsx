"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "@/components/layout/navigation-progress";

/**
 * The owner closes the club (BUG-013, part 3; D7). Closing archives it: its
 * history stays readable, nothing new can be added, the subscription ends now
 * with no refund, and only support can reopen it.
 */
export function CloseClubSection({ orgId, clubName }: { orgId: string; clubName: string }) {
  const { navigate } = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === clubName.trim().toLowerCase();

  async function close() {
    setBusy(true);
    try {
      const res = await fetch("/api/club/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, confirmName: typed }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Something went wrong");
        return;
      }
      toast.success(`${clubName} is closed. Its history is still readable.`);
      navigate("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-destructive">Close the club</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Closing ends the club on Lista. Its teams, schedules and chat stay readable by their members, but nothing new
        can be added.
      </p>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Close club
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {clubName}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Every team becomes read-only: members can still see the roster, schedule, availability and chat,
                  but nobody can add or change anything.
                </p>
                <p>The club&apos;s subscription is cancelled now, with no refund for the rest of the period.</p>
                <p>The club&apos;s web address is released, and every member is emailed.</p>
                <p>Only Lista support can reopen a closed club.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirmClubName">Type {clubName} to confirm</Label>
            <Input id="confirmClubName" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!matches || busy} onClick={close}>
              Close this club
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
