"use server";

import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { ACTIVE_PROFILE_COOKIE } from "./constants";

function adminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Accept an invitation as the currently signed-in user (their own account).
 * Used for manager/coach invites, and for player invites where the person
 * confirms they are the invited player.
 */
export async function acceptInvitationAsSelf(invitationId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = adminClient();

  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("*")
    .eq("id", invitationId)
    .single();

  if (inviteError || !invitation) return { error: "Invitation not found" };
  if (invitation.accepted_at) return { error: "Invitation already accepted" };

  // Add to team
  const { error: memberError } = await admin.from("team_members").insert({
    team_id: invitation.team_id!,
    profile_id: user.id,
    role: invitation.role as Database["public"]["Tables"]["team_members"]["Row"]["role"],
  });

  if (memberError && memberError.code !== "23505") {
    return { error: memberError.message };
  }

  // Apply birthday/gender from invitation to user's profile
  const profileUpdate: Record<string, string | null> = {};
  if (invitation.birthday) profileUpdate.birthday = invitation.birthday;
  if (invitation.gender) profileUpdate.gender = invitation.gender;
  if (Object.keys(profileUpdate).length > 0) {
    await admin.from("profiles").update(profileUpdate).eq("id", user.id);
  }

  // Set active_team_id
  await admin
    .from("profiles")
    .update({ active_team_id: invitation.team_id })
    .eq("id", user.id);

  // Mark invitation accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitationId);

  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/**
 * Accept a player invitation as a parent/guardian: creates a managed profile
 * for the player and links the current user as manager.
 */
export async function acceptInvitationAsGuardian(
  invitationId: string,
  {
    relationship,
    firstName,
    lastName,
  }: {
    relationship: string;
    firstName?: string;
    lastName?: string;
  }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = adminClient();

  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("*")
    .eq("id", invitationId)
    .single();

  if (inviteError || !invitation) return { error: "Invitation not found" };
  if (invitation.accepted_at) return { error: "Invitation already accepted" };

  // Create managed profile for the player using invitation data
  const profileId = crypto.randomUUID();
  const { error: profileError } = await admin.from("profiles").insert({
    id: profileId,
    first_name: invitation.first_name ?? "",
    last_name: invitation.last_name ?? "",
    email: `managed-${profileId}@lista.internal`,
    birthday: invitation.birthday ?? null,
    gender: invitation.gender ?? null,
  });
  if (profileError) return { error: profileError.message };

  // Link current user as manager
  const { error: linkError } = await admin.from("profile_managers").insert({
    manager_id: user.id,
    managed_id: profileId,
    relationship: relationship ?? null,
  });
  if (linkError) {
    await admin.from("profiles").delete().eq("id", profileId);
    return { error: linkError.message };
  }

  // Add managed profile to team
  const { error: memberError } = await admin.from("team_members").insert({
    team_id: invitation.team_id!,
    profile_id: profileId,
    role: invitation.role as Database["public"]["Tables"]["team_members"]["Row"]["role"],
  });
  if (memberError) return { error: memberError.message };

  // Update current user's own profile name if provided
  const userProfileUpdate: Record<string, string> = {};
  if (firstName) userProfileUpdate.first_name = firstName;
  if (lastName) userProfileUpdate.last_name = lastName;
  if (Object.keys(userProfileUpdate).length > 0) {
    await admin.from("profiles").update(userProfileUpdate).eq("id", user.id);
  }

  // Set active_team_id on user's own profile
  await admin
    .from("profiles")
    .update({ active_team_id: invitation.team_id })
    .eq("id", user.id);

  // Mark invitation accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitationId);

  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/**
 * Accept a "manage existing player" invitation.
 * Creates a profile_managers link between the current user and the
 * invitation's managed_profile_id. Sets the active profile cookie so the
 * user immediately views the dashboard as the managed player.
 */
export async function acceptManagerInvitation(invitationId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = adminClient();

  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("*")
    .eq("id", invitationId)
    .single();

  if (inviteError || !invitation) return { error: "Invitation not found" };
  if (invitation.accepted_at) return { error: "Invitation already accepted" };
  if (!invitation.managed_profile_id) return { error: "Invalid invitation type" };

  // Link current user as a manager of the existing player profile
  const { error: linkError } = await admin.from("profile_managers").insert({
    manager_id: user.id,
    managed_id: invitation.managed_profile_id,
    relationship: invitation.relationship ?? null,
  });

  if (linkError && linkError.code !== "23505") {
    return { error: linkError.message };
  }

  // Mark invitation accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitationId);

  // Switch the session to view as the managed player so the dashboard works
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROFILE_COOKIE, invitation.managed_profile_id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
