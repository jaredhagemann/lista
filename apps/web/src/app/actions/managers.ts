"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { LAST_GUARDIAN_MESSAGE, isLastGuardianError } from "@/lib/guardians";

function adminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Remove a profile_managers link. Uses service role to bypass RLS.
 *
 * Per D1 (BUG-002) a guardian may be removed by the guardian themselves, by
 * another guardian of the same player, or by the player. A staff role alone does
 * not grant removal: the link is global, so a coach at one club could otherwise
 * sever a parent's access at every other club.
 *
 * The database refuses to remove the last guardian of a player with no login of
 * their own; that refusal is returned as LAST_GUARDIAN_MESSAGE.
 */
export async function removeProfileManager(managersRowId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = adminClient();

  // Fetch the row to verify the caller has permission
  const { data: row } = await admin
    .from("profile_managers")
    .select("manager_id, managed_id")
    .eq("id", managersRowId)
    .single();

  if (!row) return { error: "Not found" };

  // A Self link (manager = managed) is the account holder's own record, not a
  // guardian relationship. It lasts as long as the profile — not even the player
  // may remove it (BUG-002 review, finding 3).
  if (row.manager_id === row.managed_id) return { error: "Not authorized" };

  const isSelf = row.manager_id === user.id;
  const isPlayer =
    !isSelf &&
    (await admin
      .from("profiles")
      .select("auth_user_id")
      .eq("id", row.managed_id)
      .single()
      .then(({ data }) => data?.auth_user_id === user.id));
  // A player's own Self link would also match below, so exclude the player.
  const isOtherGuardian =
    !isSelf &&
    !isPlayer &&
    user.id !== row.managed_id &&
    (await admin
      .from("profile_managers")
      .select("id")
      .eq("manager_id", user.id)
      .eq("managed_id", row.managed_id)
      .maybeSingle()
      .then(({ data }) => !!data));

  if (!isSelf && !isPlayer && !isOtherGuardian) return { error: "Not authorized" };

  const { error } = await admin
    .from("profile_managers")
    .delete()
    .eq("id", managersRowId);

  if (isLastGuardianError(error)) return { error: LAST_GUARDIAN_MESSAGE };
  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return { success: true };
}

/**
 * Update relationship and/or phone on a profile_managers row.
 * Callable by the manager themselves or a team admin.
 */
export async function updateProfileManager(
  managersRowId: string,
  updates: { relationship?: string; phone?: string }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const admin = adminClient();

  const { data: row } = await admin
    .from("profile_managers")
    .select("manager_id, managed_id")
    .eq("id", managersRowId)
    .single();

  if (!row) return { error: "Not found" };

  const isSelf = row.manager_id === user.id;
  const isAdmin =
    !isSelf &&
    (await admin
      .from("team_members")
      .select("id, team_id")
      .eq("profile_id", user.id)
      .in("role", ["coach", "manager", "director"])
      .then(async ({ data: adminMemberships }) => {
        if (!adminMemberships?.length) return false;
        const { data: managedMemberships } = await admin
          .from("team_members")
          .select("team_id")
          .eq("profile_id", row.managed_id);
        const managedTeams = new Set(
          (managedMemberships ?? []).map((m) => m.team_id)
        );
        return adminMemberships.some((m) => managedTeams.has(m.team_id));
      }));

  if (!isSelf && !isAdmin) return { error: "Not authorized" };

  const { error } = await admin
    .from("profile_managers")
    .update({
      relationship: updates.relationship,
      phone: updates.phone,
    })
    .eq("id", managersRowId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
