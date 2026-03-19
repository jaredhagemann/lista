"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { ACTIVE_PROFILE_COOKIE } from "./constants";
import { getActiveProfileId } from "@/lib/get-active-membership";

export async function setActiveTeam(teamId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Find all profiles belonging to this user (own + managed)
  const { data: managedLinks } = await supabase
    .from("profile_managers")
    .select("managed_id")
    .eq("manager_id", user.id);

  const allProfileIds = [
    user.id,
    ...(managedLinks ?? []).map((l) => l.managed_id),
  ];

  // Find which of those profiles are members of the target team
  const { data: memberships } = await supabase
    .from("team_members")
    .select("profile_id, role")
    .eq("team_id", teamId)
    .in("profile_id", allProfileIds);

  if (!memberships || memberships.length === 0) {
    return { error: "Not a member of this team" };
  }

  // Default to own profile if it's on the team; otherwise use first managed profile
  const ownMembership = memberships.find((m) => m.profile_id === user.id);
  const chosenProfileId = ownMembership
    ? user.id
    : memberships[0].profile_id!;

  // Update active_team_id on the chosen profile (use service role to allow updating managed profiles)
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  await admin
    .from("profiles")
    .update({ active_team_id: teamId })
    .eq("id", chosenProfileId);

  // Update the active_profile_id cookie
  const cookieStore = await cookies();
  if (chosenProfileId === user.id) {
    cookieStore.delete(ACTIVE_PROFILE_COOKIE);
  } else {
    cookieStore.set(ACTIVE_PROFILE_COOKIE, chosenProfileId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }

  revalidatePath("/dashboard", "layout");
  return { success: true };
}

export async function removeTeamMember(memberId: string, teamId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const activeProfileId = await getActiveProfileId(user.id);

  // Verify caller is an admin on this team
  const { data: callerMembership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("profile_id", activeProfileId)
    .maybeSingle();

  if (
    !callerMembership ||
    !["coach", "manager"].includes(callerMembership.role)
  ) {
    return { error: "Not authorized" };
  }

  // Fetch the target member's profile_id
  const { data: target } = await supabase
    .from("team_members")
    .select("profile_id")
    .eq("id", memberId)
    .eq("team_id", teamId)
    .single();

  if (!target) return { error: "Member not found" };

  const profileId = target.profile_id!;

  // Block self-removal
  if (profileId === activeProfileId) {
    return { error: "You cannot remove yourself from the team" };
  }

  // Service role client for cleanup operations that cross RLS boundaries
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Fetch profile email for invitation voiding
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .single();

  // Fetch team channel IDs and upcoming event IDs in parallel
  const now = new Date().toISOString();
  const [{ data: teamChannels }, { data: upcomingEvents }] = await Promise.all([
    admin.from("channels").select("id").eq("team_id", teamId),
    admin.from("events").select("id").eq("team_id", teamId).gte("start_time", now),
  ]);

  const channelIds = (teamChannels ?? []).map((c) => c.id);
  const upcomingEventIds = (upcomingEvents ?? []).map((e) => e.id);

  // Run all cleanup in parallel before deleting the membership row
  await Promise.all([
    // Delete upcoming availability responses (preserve historical ones)
    upcomingEventIds.length > 0
      ? admin
          .from("availability")
          .delete()
          .eq("profile_id", profileId)
          .in("event_id", upcomingEventIds)
      : Promise.resolve(),

    // Remove from group/team channel membership
    channelIds.length > 0
      ? admin
          .from("channel_members")
          .delete()
          .eq("profile_id", profileId)
          .in("channel_id", channelIds)
      : Promise.resolve(),

    // Void pending invitations linked to this profile (managed profile flow)
    admin
      .from("invitations")
      .delete()
      .eq("team_id", teamId)
      .eq("managed_profile_id", profileId)
      .is("accepted_at", null),

    // Void pending invitations sent to this profile's email (direct invite flow)
    ...(targetProfile?.email
      ? [
          admin
            .from("invitations")
            .delete()
            .eq("team_id", teamId)
            .eq("email", targetProfile.email)
            .is("accepted_at", null),
        ]
      : []),
  ]);

  // Delete the team_members row — this is the access-revoking step
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("team_id", teamId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/team");
  return { success: true };
}
