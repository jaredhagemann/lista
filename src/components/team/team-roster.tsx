"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MemberDetailSheet,
  type TeamMemberWithProfile,
} from "@/components/team/member-detail-sheet";
import type { Database } from "@/types/database";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

interface TeamRosterProps {
  members: TeamMemberWithProfile[];
  contactsByProfile: Record<string, ContactRow[]>;
  isAdmin: boolean;
  teamId: string;
}

export function TeamRoster({
  members,
  contactsByProfile,
  isAdmin,
  teamId,
}: TeamRosterProps) {
  const [selectedMember, setSelectedMember] =
    useState<TeamMemberWithProfile | null>(null);

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

    return (
      <div
        className="flex cursor-pointer items-center justify-between rounded-md p-3 hover:bg-accent"
        onClick={() => setSelectedMember(member)}
      >
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">
              {fullName}
              {member.jersey_number != null && (
                <span className="ml-2 text-muted-foreground">
                  #{member.jersey_number}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">{profile.email}</p>
          </div>
        </div>
        <Badge variant="secondary" className="capitalize">
          {member.role}
        </Badge>
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
          </div>
        </CardContent>
      </Card>

      {selectedMember && (
        <MemberDetailSheet
          member={selectedMember}
          contacts={contactsByProfile[selectedMember.profile_id] ?? []}
          isAdmin={isAdmin}
          teamId={teamId}
          open={!!selectedMember}
          onOpenChange={(open) => {
            if (!open) setSelectedMember(null);
          }}
        />
      )}
    </>
  );
}
