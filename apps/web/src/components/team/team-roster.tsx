"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Clock, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

export type TeamMemberWithProfile = TeamMemberRow & {
  profiles: ProfileRow;
};

export type ContactInfo = {
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
};

interface TeamRosterProps {
  members: TeamMemberWithProfile[];
  pendingInvites?: InvitationRow[];
  isAdmin: boolean;
  teamId: string;
  ownerId?: string | null;
  contactsMap?: Record<string, ContactInfo>;
}

export function TeamRoster({
  members,
  pendingInvites = [],
  ownerId,
  contactsMap = {},
}: TeamRosterProps) {
  const router = useRouter();
  const [invites, setInvites] = useState(pendingInvites);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const pendingPlayers = invites.filter((i) => i.role === "player");
  const pendingNonPlayers = invites.filter((i) => i.role !== "player");

  const players = members
    .filter((m) => m.role === "player")
    .sort((a, b) => {
      if (a.jersey_number == null && b.jersey_number == null) return 0;
      if (a.jersey_number == null) return 1;
      if (b.jersey_number == null) return -1;
      return a.jersey_number - b.jersey_number;
    });

  const nonPlayerRoleOrder = { coach: 0, manager: 1 };
  const nonPlayers = members
    .filter((m) => m.role !== "player")
    .sort(
      (a, b) =>
        (nonPlayerRoleOrder[a.role as keyof typeof nonPlayerRoleOrder] ?? 3) -
        (nonPlayerRoleOrder[b.role as keyof typeof nonPlayerRoleOrder] ?? 3)
    );

  async function handleResend(invite: InvitationRow) {
    setLoadingId(invite.id);
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
      setLoadingId(null);
    }
  }

  async function handleDelete(invite: InvitationRow) {
    setLoadingId(invite.id);
    try {
      const res = await fetch(`/api/invitations/${invite.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete invitation");
      } else {
        setInvites((prev) => prev.filter((i) => i.id !== invite.id));
        toast.success("Invitation deleted");
        router.refresh();
      }
    } catch {
      toast.error("Failed to delete invitation");
    } finally {
      setLoadingId(null);
    }
  }

  function MemberRow({ member }: { member: TeamMemberWithProfile }) {
    const profile = member.profiles;
    const fullName = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(" ");
    const initials = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .toUpperCase();

    const isPlayer = member.role === "player";
    const jerseyLine = isPlayer
      ? [
          member.jersey_number != null ? `#${member.jersey_number}` : null,
          member.position ?? null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

    const contact = member.profile_id ? contactsMap[member.profile_id] : null;

    return (
      <div
        className="flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-accent"
        onClick={() => router.push(`/dashboard/team/${member.id}`)}
      >
        <Avatar>
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt={fullName} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{fullName}</p>
          {jerseyLine && (
            <p className="text-sm text-muted-foreground">{jerseyLine}</p>
          )}
        </div>
        {contact ? (
          <div className="hidden shrink-0 text-right text-sm sm:block">
            <p className="font-medium text-foreground">
              {contact.name}
              {contact.relationship && (
                <span className="font-normal capitalize text-muted-foreground"> · {contact.relationship}</span>
              )}
            </p>
            {contact.email && <p className="text-muted-foreground">{contact.email}</p>}
            {contact.phone && <p className="text-muted-foreground">{contact.phone}</p>}
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div className="flex shrink-0 items-center gap-1">
          {ownerId && member.profile_id === ownerId && (
            <Badge variant="outline" className="shrink-0 border-amber-400 text-amber-600">
              Team Owner
            </Badge>
          )}
          <Badge variant="secondary" className="capitalize shrink-0">
            {member.role}
          </Badge>
        </div>
      </div>
    );
  }

  function PendingInviteRow({ invite }: { invite: InvitationRow }) {
    const fullName = [invite.first_name, invite.last_name]
      .filter(Boolean)
      .join(" ");
    const initials = [invite.first_name, invite.last_name]
      .filter(Boolean)
      .map((n) => n![0])
      .join("")
      .toUpperCase();
    const busy = loadingId === invite.id;

    return (
      <div className="flex items-center justify-between rounded-md border border-dashed p-3">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials || "?"}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{fullName || invite.email}</p>
            {fullName && (
              <p className="text-sm text-muted-foreground">{invite.email}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Invited
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={busy}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleResend(invite)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Resend
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => handleDelete(invite)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {players.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
            {pendingPlayers.map((invite) => (
              <PendingInviteRow key={invite.id} invite={invite} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Non Players</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {nonPlayers.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
            {pendingNonPlayers.map((invite) => (
              <PendingInviteRow key={invite.id} invite={invite} />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
