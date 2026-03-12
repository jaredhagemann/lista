"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { ACTIVE_PROFILE_COOKIE } from "./constants";

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
