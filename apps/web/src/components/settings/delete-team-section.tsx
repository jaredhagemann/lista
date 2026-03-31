"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { deleteTeam } from "@/app/actions/team";

interface DeleteTeamSectionProps {
  teamId: string;
  teamName: string;
}

export function DeleteTeamSection({ teamId, teamName }: DeleteTeamSectionProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (confirmation !== teamName) return;
    setLoading(true);
    const result = await deleteTeam(teamId);
    // deleteTeam redirects on success — if we get here there was an error
    if (result?.error) {
      toast.error(result.error);
      setLoading(false);
    }
  }

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Permanently delete this team and all associated data — members, events, chat history, and images. This action cannot be undone.
        </p>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete Team
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setConfirmation(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{teamName}</strong> and all of its data. All members will be notified. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <strong>{teamName}</strong> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={teamName}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmation !== teamName || loading}
            >
              {loading ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
