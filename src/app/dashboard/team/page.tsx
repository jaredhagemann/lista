import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InviteMemberDialog } from "@/components/team/invite-member-dialog";
import type { Database } from "@/types/database";

type TeamMemberWithTeam = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Database["public"]["Tables"]["profiles"]["Row"];
};

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get current user's team
  const { data: rawMembership } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  if (!rawMembership) {
    redirect("/dashboard");
  }

  const membership = rawMembership as TeamMemberWithTeam;
  const team = membership.teams as { id: string; name: string };
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  // Get all team members with profiles
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("team_id", team.id)
    .order("role");

  const members = (rawMembers ?? []) as TeamMemberWithProfile[];

  const roleOrder = { coach: 0, manager: 1, player: 2, parent: 3 };
  const sortedMembers = members?.sort(
    (a, b) =>
      (roleOrder[a.role as keyof typeof roleOrder] ?? 4) -
      (roleOrder[b.role as keyof typeof roleOrder] ?? 4)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{team.name} — Roster</h1>
        {isAdmin && <InviteMemberDialog teamId={team.id} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedMembers?.map((member) => {
              const profile = member.profiles as {
                full_name: string;
                email: string;
                phone: string | null;
              };
              const initials = profile.full_name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-md p-3 hover:bg-accent"
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">
                        {profile.full_name}
                        {member.jersey_number != null && (
                          <span className="ml-2 text-muted-foreground">
                            #{member.jersey_number}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {profile.email}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {member.role}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
