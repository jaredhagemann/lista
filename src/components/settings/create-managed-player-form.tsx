"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createManagedProfile } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export function CreateManagedPlayerForm({ managerId }: { managerId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    birthday: "",
    relationship: "",
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
      relationship: form.relationship.trim() || undefined,
      managerId,
    });

    setLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success(`${form.firstName} added.`);
    setForm({ firstName: "", lastName: "", email: "", birthday: "", relationship: "" });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a player</CardTitle>
        <CardDescription>
          Create a profile for a player you manage. They can be added to a team
          from the team roster page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-first-name">First name *</Label>
              <Input
                id="mp-first-name"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-last-name">Last name</Label>
              <Input
                id="mp-last-name"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-relationship">Relationship</Label>
            <Input
              id="mp-relationship"
              placeholder="e.g. Son, Daughter"
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-email">Email (optional)</Label>
            <Input
              id="mp-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              For reference only. If this email signs up later, they&apos;ll be
              linked to this profile.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-birthday">Birthday (optional)</Label>
            <Input
              id="mp-birthday"
              type="date"
              value={form.birthday}
              onChange={(e) => set("birthday", e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading || !form.firstName.trim()}>
            {loading ? "Adding..." : "Add player"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
