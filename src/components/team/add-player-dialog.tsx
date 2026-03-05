"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createManagedProfile } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AddPlayerDialog({
  teamId,
  managerId,
}: {
  teamId: string;
  /** The profile ID of the admin creating the player (becomes manager). */
  managerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    birthday: "",
  });

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim()) return;
    setLoading(true);

    const result = await createManagedProfile({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim() || undefined,
      email: form.email.trim() || undefined,
      birthday: form.birthday || undefined,
      managerId,
      teamId,
      role: "player",
    });

    setLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success(`${form.firstName} added to the team.`);
    setOpen(false);
    setForm({ firstName: "", lastName: "", email: "", birthday: "" });
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" />
        Add player
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add player</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Creates a managed profile for a player who doesn&apos;t have their
              own account (e.g. a child). You&apos;ll be linked as their manager.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-first-name">First name *</Label>
                <Input
                  id="add-first-name"
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-last-name">Last name</Label>
                <Input
                  id="add-last-name"
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email">Contact email</Label>
              <Input
                id="add-email"
                type="email"
                placeholder="parent@example.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                If this email matches an existing account, that person will also
                be linked as a manager.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-birthday">Birthday</Label>
              <Input
                id="add-birthday"
                type="date"
                value={form.birthday}
                onChange={(e) => set("birthday", e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !form.firstName.trim()}>
                {loading ? "Adding..." : "Add player"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
