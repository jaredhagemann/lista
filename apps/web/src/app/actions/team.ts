"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Database } from "@/types/database";
import { ACTIVE_PROFILE_COOKIE } from "./constants";
import { getActiveProfileId } from "@/lib/get-active-membership";
import { sendTeamDeletionNotifications } from "@/lib/notifications/team-deletion";

const BASE_DOMAIN = "lista.team";

function activeProfileCookieOptions(overrides: { maxAge?: number } = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    domain:
      process.env.SUBDOMAIN_ROUTING_ENABLED !== "false" &&
      process.env.NODE_ENV === "production"
        ? `.${BASE_DOMAIN}`
        : undefined,
    ...overrides,
  };
}

export async function clearActiveProfile() {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROFILE_COOKIE, "", activeProfileCookieOptions({ maxAge: 0 }));
}

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
    cookieStore.set(ACTIVE_PROFILE_COOKIE, "", activeProfileCookieOptions({ maxAge: 0 }));
  } else {
    cookieStore.set(ACTIVE_PROFILE_COOKIE, chosenProfileId, activeProfileCookieOptions());
  }

  revalidatePath("/dashboard", "layout");

  // Subdomain routing is enabled by default; set SUBDOMAIN_ROUTING_ENABLED=false to suppress
  // it in environments (e.g. staging) where *.lista.team subdomains are not available.
  // Also suppress when TENANT_OVERRIDE_HOSTNAME is set — that var simulates a subdomain for
  // UI testing only; the user is not actually on a lista.team URL, so routing must be a no-op.
  if (process.env.SUBDOMAIN_ROUTING_ENABLED === "false" || process.env.TENANT_OVERRIDE_HOSTNAME) {
    return { success: true as const };
  }

  // Determine if a cross-domain redirect is needed.
  // Read the current hostname from the incoming request headers.
  const headerStore = await headers();
  const host = (headerStore.get("host") ?? "").split(":")[0];
  const currentSubdomain = host.endsWith(`.${BASE_DOMAIN}`) && host !== `www.${BASE_DOMAIN}`
    ? host.slice(0, -(`.${BASE_DOMAIN}`.length))
    : null;

  // Look up the target team's org subdomain.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .single();

  let targetSubdomain: string | null = null;
  if (teamRow?.organization_id) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("subdomain, subdomain_status, plan")
      .eq("id", teamRow.organization_id)
      .maybeSingle();
    if (orgRow?.plan === "club" && orgRow?.subdomain_status === "active" && orgRow?.subdomain) {
      targetSubdomain = orgRow.subdomain;
    }
  }

  if (targetSubdomain && currentSubdomain !== targetSubdomain) {
    return { success: true as const, redirectUrl: `https://${targetSubdomain}.${BASE_DOMAIN}/dashboard` };
  }
  if (!targetSubdomain && currentSubdomain) {
    return { success: true as const, redirectUrl: `https://${BASE_DOMAIN}/dashboard` };
  }

  return { success: true as const };
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
    !["coach", "manager", "director"].includes(callerMembership.role)
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

  // Block removal of the current team owner — they must transfer ownership first.
  // This applies whether the removal is self-initiated or initiated by another admin.
  // Non-owner admins may remove themselves freely.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("owner_id")
    .eq("id", teamId)
    .single();

  if (teamRow?.owner_id === profileId) {
    return { error: "Transfer ownership before removing the team owner" };
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

export async function transferOwnership(teamId: string, newOwnerProfileId: string) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Ownership is a property of the auth user, not the active profile.
  // owner_id always references an auth-backed profile whose id equals the auth user's id.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("owner_id, organization_id")
    .eq("id", teamId)
    .single();

  if (!teamRow) return { error: "Team not found" };

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Allow the team owner OR an org director/owner to transfer ownership
  const isTeamOwner = teamRow.owner_id === user.id;
  let isOrgAdmin = false;
  if (!isTeamOwner && teamRow.organization_id) {
    const { data: orgMembership } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", teamRow.organization_id)
      .eq("profile_id", user.id)
      .maybeSingle();
    isOrgAdmin = ["owner", "director"].includes(orgMembership?.role ?? "");
  }

  if (!isTeamOwner && !isOrgAdmin) return { error: "Not authorized" };

  // Verify recipient is a current coach, manager, or director with a real auth account
  const { data: recipientMembership } = await admin
    .from("team_members")
    .select("role, profiles(auth_user_id)")
    .eq("team_id", teamId)
    .eq("profile_id", newOwnerProfileId)
    .maybeSingle();

  if (!recipientMembership) return { error: "Recipient is not a team member" };
  if (!["coach", "manager", "director"].includes(recipientMembership.role)) {
    return { error: "Ownership can only be transferred to a coach, manager, or director" };
  }
  const recipientProfile = recipientMembership.profiles as { auth_user_id: string | null } | null;
  if (!recipientProfile?.auth_user_id) {
    return { error: "Ownership cannot be transferred to a managed profile" };
  }

  const { error } = await admin
    .from("teams")
    .update({ owner_id: newOwnerProfileId })
    .eq("id", teamId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/team");
  return { success: true };
}

export async function deleteTeam(teamId: string) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Ownership is a property of the auth user, not the active profile.
  // owner_id always references an auth-backed profile whose id equals the auth user's id.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("owner_id, name")
    .eq("id", teamId)
    .single();

  if (!teamRow) return { error: "Team not found" };
  if (teamRow.owner_id !== user.id) return { error: "Not authorized" };

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Fan out notifications to all members (best-effort — failures do not abort)
  await sendTeamDeletionNotifications(teamId, teamRow.name);

  // Delete all storage objects under team-images/{teamId}/
  const { data: storageObjects } = await admin.storage
    .from("team-images")
    .list(teamId);

  if (storageObjects && storageObjects.length > 0) {
    const paths = storageObjects.map((obj) => `${teamId}/${obj.name}`);
    await admin.storage.from("team-images").remove(paths);
  }

  // Delete the team — cascades handle all child records
  const { error } = await admin.from("teams").delete().eq("id", teamId);
  if (error) return { error: error.message };

  redirect("/dashboard");
}
