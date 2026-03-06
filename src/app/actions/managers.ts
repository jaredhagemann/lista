"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

function adminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Remove a profile_managers link. Callable by the manager themselves or a
 * team admin. Uses service role to bypass RLS.
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

  const isSelf = row.manager_id === user.id;
  const isAdmin =
    !isSelf &&
    (await admin
      .from("team_members")
      .select("id, team_id")
      .eq("profile_id", user.id)
      .in("role", ["coach", "manager"])
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
    .delete()
    .eq("id", managersRowId);

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
      .in("role", ["coach", "manager"])
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
