import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { RosterProfile } from "@/components/team/roster-profile";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export type TeamMemberWithProfile = TeamMemberRow & {
  profiles: ProfileRow;
};

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch the target team member with profile
  const { data: rawMember } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("id", memberId)
    .single();

  if (!rawMember) notFound();

  const member = rawMember as TeamMemberWithProfile;

  // Fetch the current user's membership on the same team
  const { data: rawCurrentMembership } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", member.team_id!)
    .eq("profile_id", user.id)
    .single();

  if (!rawCurrentMembership) redirect("/dashboard");

  const currentMembership =
    rawCurrentMembership as TeamMemberRow;
  const isAdmin =
    currentMembership.role === "coach" ||
    currentMembership.role === "manager";
  const isOwnProfile = member.profile_id === user.id;
  const canEdit = isOwnProfile || isAdmin;

  // Fetch contacts for the target member
  const { data: rawContacts } = await supabase
    .from("contacts")
    .select("*")
    .eq("profile_id", member.profile_id!)
    .order("created_at");

  const contacts = (rawContacts ?? []) as ContactRow[];

  return (
    <RosterProfile
      member={member}
      contacts={contacts}
      canEdit={canEdit}
      isAdmin={isAdmin}
      teamId={member.team_id!}
    />
  );
}
