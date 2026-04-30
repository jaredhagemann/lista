"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus } from "lucide-react";

type Director = {
  profile_id: string;
  role: string;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

export function ClubSettingsClient({
  org,
  orgRole,
  directors,
  currentUserId,
}: {
  org: { id: string; name: string; orgNamePublic: string | null };
  orgRole: "owner" | "director";
  directors: Director[];
  currentUserId: string;
}) {
  const router = useRouter();

  // Org name form
  const [name, setName] = useState(org.name);
  const [orgNamePublic, setOrgNamePublic] = useState(org.orgNamePublic ?? "");
  const [savingName, setSavingName] = useState(false);

  // Invite director dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await fetch("/api/club/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, orgName: name.trim(), orgNamePublic: orgNamePublic.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to save");
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    } finally {
      setSavingName(false);
    }
  }

  async function handleInviteDirector(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/club/directors/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, email: inviteEmail.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to invite director");
        return;
      }
      toast.success("Invitation sent");
      setInviteOpen(false);
      setInviteEmail("");
      router.refresh();
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveDirector(profileId: string) {
    const res = await fetch("/api/club/directors/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: org.id, profileId }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      toast.error(error ?? "Failed to remove director");
      return;
    }
    toast.success("Director removed");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Org name */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Organization</h2>
        <form onSubmit={handleSaveName} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="name">Internal name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside FC"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgNamePublic">Public display name</Label>
            <Input
              id="orgNamePublic"
              value={orgNamePublic}
              onChange={(e) => setOrgNamePublic(e.target.value)}
              placeholder="e.g. Riverside Football Club"
            />
            <p className="text-xs text-muted-foreground">
              Shown to players and parents on the club portal.
            </p>
          </div>
          <Button type="submit" disabled={savingName}>
            {savingName ? "Saving…" : "Save"}
          </Button>
        </form>
      </section>

      {/* Directors */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Directors</h2>
          {orgRole === "owner" && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  Invite director
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a director</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleInviteDirector} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="inviteEmail">Email address</Label>
                    <Input
                      id="inviteEmail"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="director@example.com"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={inviting}>
                    {inviting ? "Sending…" : "Send invitation"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {orgRole === "owner" && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {directors.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={orgRole === "owner" ? 4 : 3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No directors yet.
                  </TableCell>
                </TableRow>
              ) : (
                directors.map((d) => {
                  const name =
                    [d.profiles?.first_name, d.profiles?.last_name]
                      .filter(Boolean)
                      .join(" ") || "—";
                  const isCurrentUser = d.profile_id === currentUserId;
                  return (
                    <TableRow key={d.profile_id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {d.profiles?.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.role === "owner" ? "default" : "secondary"}>
                          {d.role === "owner" ? "Owner" : "Director"}
                        </Badge>
                      </TableCell>
                      {orgRole === "owner" && (
                        <TableCell>
                          {d.role !== "owner" && !isCurrentUser && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemoveDirector(d.profile_id)}
                            >
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
