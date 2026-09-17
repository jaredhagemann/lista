"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { LAST_GUARDIAN_MESSAGE, SELF_LINK_MESSAGE, isLastGuardianError } from "@/lib/guardians";
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
 * Create a managed profile (no auth account) guarded by the signed-in user.
 * Always uses service role since managed profiles cannot be inserted via the
 * normal profiles INSERT policy.
 *
 * Because this client bypasses RLS, the action decides every link itself:
 *   - no team admission (BUG-001): players join teams through an admin or an
 *     accepted invitation
 *   - the guardian is always the signed-in user, never a caller-supplied id, and
 *     no one else is linked without accepting an invitation (BUG-002, D1)
 */
export async function createManagedProfile({
  firstName,
  lastName,
  email,
  birthday,
  relationship,
}: {
  firstName: string;
  lastName?: string;
  email?: string;
  birthday?: string;
  relationship?: string;
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

  // Link the signed-in user as guardian
  const { error: linkError } = await admin.from("profile_managers").insert({
    manager_id: user.id,
    managed_id: profileId,
    relationship: relationship ?? null,
  });
  if (linkError) {
    // Clean up the profile if linking fails
    await admin.from("profiles").delete().eq("id", profileId);
    return { error: linkError.message };
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

  // The caller's own Self link is not a managed player and lasts as long as
  // their profile (BUG-002 review, finding 3).
  if (managedId === user.id) return { error: SELF_LINK_MESSAGE };

  const { error } = await supabase
    .from("profile_managers")
    .delete()
    .eq("manager_id", user.id)
    .eq("managed_id", managedId);

  if (isLastGuardianError(error)) return { error: LAST_GUARDIAN_MESSAGE };
  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
