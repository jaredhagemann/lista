import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import { RosterProfile } from "@/components/team/roster-profile";
import { getActiveProfileId } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileManagerRow =
  Database["public"]["Tables"]["profile_managers"]["Row"] & {
    profiles: ProfileRow;
  };
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

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

  const activeProfileId = await getActiveProfileId(user.id);

  // Fetch the target team member with profile
  const { data: rawMember } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("id", memberId)
    .single();

  if (!rawMember) notFound();

  const member = rawMember as TeamMemberWithProfile;

  // Fetch the active profile's membership on the same team to determine privileges
  const { data: rawCurrentMembership } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", member.team_id!)
    .eq("profile_id", activeProfileId)
    .single();

  if (!rawCurrentMembership) redirect("/dashboard");

  const currentMembership = rawCurrentMembership as TeamMemberRow;
  const isAdmin =
    currentMembership.role === "coach" ||
    currentMembership.role === "manager";
  // "Own profile" means the viewed profile belongs to the active profile
  const isOwnProfile = member.profile_id === activeProfileId;

  // Use service role to fetch profile_managers and pending invites —
  // avoids RLS edge cases and ensures admins always see the full picture.
  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [{ data: rawManagers }, { data: rawPendingInvites }] =
    await Promise.all([
      admin
        .from("profile_managers")
        .select("*, profiles!profile_managers_manager_id_fkey(*)")
        .eq("managed_id", member.profile_id!)
        .order("created_at"),
      admin
        .from("invitations")
        .select("*")
        .eq("managed_profile_id", member.profile_id!)
        .is("accepted_at", null)
        .order("created_at"),
    ]);

  const managers = (rawManagers ?? []) as ProfileManagerRow[];
  const pendingInvites = (rawPendingInvites ?? []) as InvitationRow[];

  const isManagerOfProfile = managers.some((m) => m.manager_id === user.id);
  const canEdit = isOwnProfile || isAdmin || isManagerOfProfile;

  return (
    <RosterProfile
      member={member}
      managers={managers}
      pendingInvites={pendingInvites}
      canEdit={canEdit}
      isAdmin={isAdmin}
      teamId={member.team_id!}
    />
  );
}
