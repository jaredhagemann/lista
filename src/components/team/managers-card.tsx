"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Plus, Pencil, Trash2, Copy, Check, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  removeProfileManager,
  updateProfileManager,
} from "@/app/actions/managers";
import type { Database } from "@/types/database";

type ProfileManagerRow =
  Database["public"]["Tables"]["profile_managers"]["Row"] & {
    profiles: Database["public"]["Tables"]["profiles"]["Row"];
  };
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

const RELATIONSHIPS = ["Self", "Mom", "Dad", "Guardian", "Other"];

export function ManagersCard({
  profileId,
  teamId,
  managers: initialManagers,
  pendingInvites: initialPendingInvites,
  canEdit,
  canAdd,
}: {
  profileId: string;
  teamId: string;
  managers: ProfileManagerRow[];
  pendingInvites: InvitationRow[];
  canEdit: boolean;
  canAdd?: boolean;
}) {
  const showAddButton = canEdit || canAdd;
  const router = useRouter();
  const [managers, setManagers] = useState(initialManagers);
  const [pendingInvites, setPendingInvites] = useState(initialPendingInvites);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRelationship, setAddRelationship] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addResult, setAddResult] = useState<{
    inviteUrl: string;
    emailSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit dialog
  const [editRow, setEditRow] = useState<ProfileManagerRow | null>(null);
  const [editRelationship, setEditRelationship] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Delete dialog
  const [deleteRow, setDeleteRow] = useState<ProfileManagerRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Resending
  const [resendingId, setResendingId] = useState<string | null>(null);

  function openEdit(row: ProfileManagerRow) {
    setEditRow(row);
    setEditRelationship(row.relationship ?? "");
    setEditPhone(row.phone ?? "");
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editRow) return;
    setEditLoading(true);

    const result = await updateProfileManager(editRow.id, {
      relationship: editRelationship || undefined,
      phone: editPhone || undefined,
    });

    if (result.error) {
      toast.error(result.error);
    } else {
      setManagers((prev) =>
        prev.map((m) =>
          m.id === editRow.id
            ? { ...m, relationship: editRelationship || null, phone: editPhone || null }
            : m
        )
      );
      toast.success("Updated");
      setEditRow(null);
      router.refresh();
    }
    setEditLoading(false);
  }

  async function handleDelete() {
    if (!deleteRow) return;
    setDeleteLoading(true);

    const result = await removeProfileManager(deleteRow.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      setManagers((prev) => prev.filter((m) => m.id !== deleteRow.id));
      setDeleteRow(null);
      toast.success("Manager removed");
      router.refresh();
    }
    setDeleteLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addRelationship) {
      toast.error("Please select a relationship");
      return;
    }
    setAddLoading(true);

    try {
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          email: addEmail,
          role: "manager",
          managedProfileId: profileId,
          relationship: addRelationship,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to send invitation");
        setAddLoading(false);
        return;
      }

      setAddResult({ inviteUrl: data.inviteUrl, emailSent: data.emailSent });
      toast.success(data.emailSent ? "Invitation sent!" : "Invitation created");
      router.refresh();
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleResend(invite: InvitationRow) {
    setResendingId(invite.id);
    try {
      const res = await fetch(`/api/invitations/${invite.id}/resend`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to resend");
      } else {
        toast.success(data.emailSent ? "Invitation resent!" : "Could not send email");
      }
    } catch {
      toast.error("Failed to resend invitation");
    } finally {
      setResendingId(null);
    }
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  function resetAdd() {
    setAddEmail("");
    setAddRelationship("");
    setAddResult(null);
    setCopied(false);
  }

  const isEmpty = managers.length === 0 && pendingInvites.length === 0;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contact Information</CardTitle>
              <CardDescription>
                People who manage or are in contact with this member.
              </CardDescription>
            </div>
            {showAddButton && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet.{canEdit ? " Add one to get started." : ""}
            </p>
          ) : (
            <div className="space-y-3">
              {managers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {m.relationship && (
                        <Badge variant="secondary">{m.relationship}</Badge>
                      )}
                      <span className="font-medium">
                        {m.profiles.first_name} {m.profiles.last_name}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {[m.profiles.email, m.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(m)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteRow(m)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-start justify-between rounded-md border border-dashed p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        Invited
                      </Badge>
                      {inv.relationship && (
                        <Badge variant="secondary">{inv.relationship}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{inv.email}</p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resendingId === inv.id}
                      onClick={() => handleResend(inv)}
                    >
                      {resendingId === inv.id ? "Sending..." : "Resend"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Manager Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAdd();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>
              Send an invitation to a parent or guardian.
            </DialogDescription>
          </DialogHeader>

          {addResult ? (
            <div className="space-y-4">
              {addResult.emailSent ? (
                <p className="text-sm text-muted-foreground">
                  Invitation sent to <strong>{addEmail}</strong>.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Invitation created but the email could not be delivered.
                    Share this link manually:
                  </p>
                  <div className="flex gap-2">
                    <Input value={addResult.inviteUrl} readOnly />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyLink(addResult.inviteUrl)}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAddOpen(false);
                    resetAdd();
                  }}
                >
                  Done
                </Button>
                <Button onClick={resetAdd}>Invite another</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-email">Email *</Label>
                <Input
                  id="add-email"
                  type="email"
                  placeholder="parent@example.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-relationship">Relationship *</Label>
                <Select
                  value={addRelationship}
                  onValueChange={setAddRelationship}
                >
                  <SelectTrigger id="add-relationship">
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={addLoading || !addRelationship}
                >
                  {addLoading ? "Sending..." : "Send invitation"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editRow} onOpenChange={(open) => !open && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-relationship">Relationship</Label>
              <Select
                value={editRelationship}
                onValueChange={setEditRelationship}
              >
                <SelectTrigger id="edit-relationship">
                  <SelectValue placeholder="Select relationship" />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Name and email are managed by the contact&apos;s own account.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteRow}
        onOpenChange={(open) => !open && setDeleteRow(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove contact</DialogTitle>
            <DialogDescription>
              Remove{" "}
              <strong>
                {deleteRow?.profiles.first_name} {deleteRow?.profiles.last_name}
              </strong>{" "}
              as a manager of this profile? This does not delete their account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRow(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              {deleteLoading ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
