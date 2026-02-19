import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { InviteMemberDialog } from "@/components/team/invite-member-dialog";
import { TeamRoster } from "@/components/team/team-roster";
import type { Database } from "@/types/database";
import type { TeamMemberWithProfile } from "@/components/team/member-detail-sheet";

type TeamMemberWithTeam = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
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

  // Fetch contacts for all team members
  const memberProfileIds = members.map((m) => m.profile_id);
  const { data: allContacts } = await supabase
    .from("contacts")
    .select("*")
    .in("profile_id", memberProfileIds);

  type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
  const contactsByProfile: Record<string, ContactRow[]> = {};
  for (const contact of (allContacts ?? []) as ContactRow[]) {
    if (!contactsByProfile[contact.profile_id]) {
      contactsByProfile[contact.profile_id] = [];
    }
    contactsByProfile[contact.profile_id].push(contact);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{team.name}</h1>
        {isAdmin && <InviteMemberDialog teamId={team.id} />}
      </div>

      <TeamRoster
        members={members}
        contactsByProfile={contactsByProfile}
        isAdmin={isAdmin}
        teamId={team.id}
      />
    </div>
  );
}
