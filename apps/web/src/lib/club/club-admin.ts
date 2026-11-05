import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Whether the profile is an owner or director of the team's club (BUG-046). The
 * roster's role editor offers Director for them, and only them: the database
 * refuses a `director` row for anyone else.
 */
export async function isClubAdminOfTeam(
  supabase: SupabaseClient<Database>,
  teamId: string,
  profileId: string
): Promise<boolean> {
  const { data: team } = await supabase.from("teams").select("organization_id").eq("id", teamId).maybeSingle();
  if (!team?.organization_id) return false;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", team.organization_id)
    .eq("profile_id", profileId)
    .in("role", ["owner", "director"])
    .maybeSingle();
  return !!membership;
}
