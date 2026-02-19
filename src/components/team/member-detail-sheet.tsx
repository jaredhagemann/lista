"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export type TeamMemberWithProfile = TeamMemberRow & {
  profiles: ProfileRow;
};

interface MemberDetailSheetProps {
  member: TeamMemberWithProfile;
  contacts: ContactRow[];
  isAdmin: boolean;
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberDetailSheet({
  member,
  contacts,
  isAdmin,
  teamId,
  open,
  onOpenChange,
}: MemberDetailSheetProps) {
  const profile = member.profiles;
  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");

  const [role, setRole] = useState(member.role);
  const [jerseyNumber, setJerseyNumber] = useState(
    member.jersey_number?.toString() ?? ""
  );
  const [savingRole, setSavingRole] = useState(false);
  const [savingJersey, setSavingJersey] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  async function handleSaveRole() {
    setSavingRole(true);
    const { error } = await supabase
      .from("team_members")
      .update({ role })
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Role updated");
      router.refresh();
    }
    setSavingRole(false);
  }

  async function handleSaveJersey() {
    setSavingJersey(true);
    const value = jerseyNumber.trim() === "" ? null : Number(jerseyNumber);
    const { error } = await supabase
      .from("team_members")
      .update({ jersey_number: value })
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Jersey number updated");
      router.refresh();
    }
    setSavingJersey(false);
  }

  async function handleRemove() {
    setRemoving(true);
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Member removed from team");
      setConfirmRemove(false);
      onOpenChange(false);
      router.refresh();
    }
    setRemoving(false);
  }

  function formatAddress(contact: ContactRow) {
    const parts = [contact.street, contact.city, contact.state, contact.zip].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{fullName}</SheetTitle>
            <SheetDescription>
              <Badge variant="secondary" className="capitalize">
                {member.role}
              </Badge>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 py-4">
            {/* Profile section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Profile</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">First name</dt>
                  <dd>{profile.first_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last name</dt>
                  <dd>{profile.last_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{profile.email}</dd>
                </div>
                {profile.birthday && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Birthday</dt>
                    <dd>{profile.birthday}</dd>
                  </div>
                )}
                {profile.gender && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Gender</dt>
                    <dd className="capitalize">{profile.gender}</dd>
                  </div>
                )}
                {member.role === "player" && member.jersey_number != null && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Jersey number</dt>
                    <dd>#{member.jersey_number}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Contacts section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Contact Information</h3>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No contacts listed.
                </p>
              ) : (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="space-y-1 rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {contact.relationship}
                        </Badge>
                        <span className="font-medium">
                          {contact.first_name} {contact.last_name}
                        </span>
                      </div>
                      {(contact.phone || contact.email) && (
                        <p className="text-muted-foreground">
                          {[contact.phone, contact.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {formatAddress(contact) && (
                        <p className="text-muted-foreground">
                          {formatAddress(contact)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Admin actions */}
            {isAdmin && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-semibold">Admin Actions</h3>

                {/* Edit role */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Role</label>
                  <div className="flex gap-2">
                    <Select
                      value={role}
                      onValueChange={(v) =>
                        setRole(v as "coach" | "manager" | "player")
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="coach">Coach</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="player">Player</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={handleSaveRole}
                      disabled={savingRole || role === member.role}
                    >
                      {savingRole ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>

                {/* Edit jersey number */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    Jersey number
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={jerseyNumber}
                      onChange={(e) => setJerseyNumber(e.target.value)}
                      placeholder="—"
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveJersey}
                      disabled={savingJersey}
                    >
                      {savingJersey ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>

                {/* Remove from team */}
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove from team
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Remove confirmation dialog */}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <strong>{fullName}</strong> from the team? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRemove(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
