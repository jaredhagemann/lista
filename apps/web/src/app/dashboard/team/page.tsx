import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AddMemberButton } from "@/components/team/add-member-button";
import { TeamRoster } from "@/components/team/team-roster";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";
import type { TeamMemberWithProfile } from "@/components/team/team-roster";

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

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

  const [{ data: rawMembers }, { data: rawPendingInvites }] =
    await Promise.all([
      supabase
        .from("team_members")
        .select("*, profiles(*)")
        .eq("team_id", team.id)
        .order("role"),
      isAdmin
        ? supabase
            .from("invitations")
            .select("*")
            .eq("team_id", team.id)
            .is("accepted_at", null)
            .is("managed_profile_id", null)
            .order("created_at")
        : Promise.resolve({ data: [] }),
    ]);

  const members = (rawMembers ?? []) as TeamMemberWithProfile[];
  const pendingInvites = (rawPendingInvites ?? []) as InvitationRow[];

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
        {isAdmin && <AddMemberButton />}
      </div>

      {team.team_photo_url && (
        <img
          src={team.team_photo_url}
          alt={`${team.name} team photo`}
          className="w-full rounded-lg object-cover"
        />
      )}

      <TeamRoster members={members} pendingInvites={pendingInvites} isAdmin={isAdmin} teamId={team.id} />
    </div>
  );
}
