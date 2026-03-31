"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { transferOwnership } from "@/app/actions/team";

interface EligibleAdmin {
  profileId: string;
  name: string;
  role: string;
}

interface TransferOwnershipSectionProps {
  teamId: string;
  eligibleAdmins: EligibleAdmin[];
}

export function TransferOwnershipSection({ teamId, eligibleAdmins }: TransferOwnershipSectionProps) {
  const [open, setOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleTransfer() {
    if (!selectedProfileId) return;
    setLoading(true);
    const result = await transferOwnership(teamId, selectedProfileId);
    setLoading(false);

    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success("Ownership transferred");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ownership</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Transfer team ownership to another coach or manager. You will retain your current role but will no longer have owner privileges.
        </p>
        {eligibleAdmins.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No other coaches or managers are available to transfer ownership to.
          </p>
        ) : (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Transfer Ownership
          </Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Team Ownership</DialogTitle>
            <DialogDescription>
              Select a coach or manager to become the new team owner. This action cannot be undone without their cooperation.
            </DialogDescription>
          </DialogHeader>

          <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a member" />
            </SelectTrigger>
            <SelectContent>
              {eligibleAdmins.map((admin) => (
                <SelectItem key={admin.profileId} value={admin.profileId}>
                  {admin.name} ({admin.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleTransfer} disabled={!selectedProfileId || loading}>
              {loading ? "Transferring..." : "Transfer Ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
