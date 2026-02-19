"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type TeamMemberWithProfile = TeamMemberRow & {
  profiles: ProfileRow;
};

interface TeamRosterProps {
  members: TeamMemberWithProfile[];
  isAdmin: boolean;
  teamId: string;
}

export function TeamRoster({
  members,
}: TeamRosterProps) {
  const router = useRouter();

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
        onClick={() => router.push(`/dashboard/team/${member.id}`)}
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
    </>
  );
}
