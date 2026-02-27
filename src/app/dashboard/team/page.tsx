import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { InviteMemberDialog } from "@/components/team/invite-member-dialog";
import { TeamRoster } from "@/components/team/team-roster";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";
import type { TeamMemberWithProfile } from "@/components/team/team-roster";

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/dashboard");

  const team = membership.teams as Database["public"]["Tables"]["teams"]["Row"];
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("team_id", team.id)
    .order("role");

  const members = (rawMembers ?? []) as TeamMemberWithProfile[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {team.logo_url && (
            <img
              src={team.logo_url}
              alt={`${team.name} logo`}
              className="h-10 w-10 rounded-lg object-cover"
            />
          )}
          <h1 className="text-2xl font-bold">{team.name}</h1>
        </div>
        {isAdmin && <InviteMemberDialog teamId={team.id} />}
      </div>

      {team.team_photo_url && (
        <img
          src={team.team_photo_url}
          alt={`${team.name} team photo`}
          className="w-full rounded-lg object-cover"
        />
      )}

      <TeamRoster members={members} isAdmin={isAdmin} teamId={team.id} />
    </div>
  );
}
