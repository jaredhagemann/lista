"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function setActiveTeam(teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  // Verify the user is actually a member of this team
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("profile_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) return { error: "Not a member of this team" };

  await supabase
    .from("profiles")
    .update({ active_team_id: teamId })
    .eq("id", user.id);

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
