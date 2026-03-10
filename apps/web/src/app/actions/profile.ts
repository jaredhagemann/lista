"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { ACTIVE_PROFILE_COOKIE } from "./constants";

/**
 * Switch to viewing as a different profile (own or managed).
 * Also updates active_team_id on that profile so the team context is preserved.
 */
export async function setActiveProfile(profileId: string, teamId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Verify the profile is either the user's own or one they manage
  const isOwn = profileId === user.id;
  if (!isOwn) {
    const { data: link } = await supabase
      .from("profile_managers")
      .select("id")
      .eq("manager_id", user.id)
      .eq("managed_id", profileId)
      .maybeSingle();
    if (!link) return { error: "Not authorized to view as this profile" };
  }

  // Verify the profile is a member of the given team
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("profile_id", profileId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!membership) return { error: "Profile is not a member of this team" };

  // Update active_team_id on the chosen profile (service role to allow updating managed profiles)
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  await admin
    .from("profiles")
    .update({ active_team_id: teamId })
    .eq("id", profileId);

  // Set cookie
  const cookieStore = await cookies();
  if (isOwn) {
    cookieStore.delete(ACTIVE_PROFILE_COOKIE);
  } else {
    cookieStore.set(ACTIVE_PROFILE_COOKIE, profileId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }

  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/**
 * Create a managed profile (no auth account). Used by both the Settings page
 * (parent creating their own managed profile) and the Team Roster (admin adding
 * a player directly). Always uses service role since managed profiles cannot be
 * inserted via the normal profiles INSERT policy.
 */
export async function createManagedProfile({
  firstName,
  lastName,
  email,
  birthday,
  relationship,
  managerId,
  teamId,
  role = "player",
}: {
  firstName: string;
  lastName?: string;
  email?: string;
  birthday?: string;
  relationship?: string;
  managerId: string; // profiles.id of the account holder who will manage this profile
  teamId?: string;  // if provided, immediately add to this team
  role?: string;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Create the managed profile (no auth_user_id)
  const profileId = crypto.randomUUID();
  const { error: profileError } = await admin.from("profiles").insert({
    id: profileId,
    first_name: firstName,
    last_name: lastName ?? "",
    email: email ?? `managed-${profileId}@lista.internal`,
    birthday: birthday ?? null,
  });
  if (profileError) return { error: profileError.message };

  // Link the manager
  const { error: linkError } = await admin.from("profile_managers").insert({
    manager_id: managerId,
    managed_id: profileId,
    relationship: relationship ?? null,
  });
  if (linkError) {
    // Clean up the profile if linking fails
    await admin.from("profiles").delete().eq("id", profileId);
    return { error: linkError.message };
  }

  // Optionally add to a team
  if (teamId) {
    const { error: memberError } = await admin.from("team_members").insert({
      team_id: teamId,
      profile_id: profileId,
      role,
    });
    if (memberError) return { error: memberError.message };
  }

  // If the manager's email matches a pending invitation, try to link
  if (email) {
    await admin
      .from("profiles")
      .select("auth_user_id")
      .eq("email", email)
      .neq("id", profileId)
      .maybeSingle()
      .then(async ({ data: existingProfile }) => {
        if (existingProfile?.auth_user_id) {
          // An account with this email already exists — link it as an additional manager
          await admin.from("profile_managers").insert({
            manager_id: existingProfile.auth_user_id,
            managed_id: profileId,
            relationship: relationship ?? null,
          }).then(() => {});
        }
      });
  }

  revalidatePath("/dashboard", "layout");
  return { success: true, profileId };
}

/**
 * Remove the manager link between the current user and a managed profile.
 * Does not delete the profile itself.
 */
export async function removeManagedProfile(managedId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("profile_managers")
    .delete()
    .eq("manager_id", user.id)
    .eq("managed_id", managedId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
