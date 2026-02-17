"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type InvitationRole = Database["public"]["Tables"]["invitations"]["Row"]["role"];
type Invitation = Database["public"]["Tables"]["invitations"]["Row"];

export function InviteMemberDialog({ teamId }: { teamId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("parent");
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const supabase = createClient();

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: rawInvitation, error } = await supabase
      .from("invitations")
      .insert({
        team_id: teamId,
        email,
        role,
        invited_by: user?.id,
      })
      .select()
      .single();

    const invitation = rawInvitation as Invitation;

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const link = `${window.location.origin}/invite/${invitation.id}`;
    setInviteLink(link);
    setLoading(false);
    toast.success("Invitation created!");
  }

  async function copyLink() {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleOpenChange(open: boolean) {
    setOpen(open);
    if (!open) {
      setEmail("");
      setRole("parent");
      setInviteLink(null);
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Generate an invite link to send to a new team member.
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Invite link</Label>
              <div className="flex gap-2">
                <Input value={inviteLink} readOnly />
                <Button variant="outline" size="icon" onClick={copyLink}>
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Share this link with the person you want to invite.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button
                onClick={() => {
                  setInviteLink(null);
                  setEmail("");
                }}
              >
                Invite another
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleInvite}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="parent@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as InvitationRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent">Parent</SelectItem>
                    <SelectItem value="player">Player</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create invite link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
