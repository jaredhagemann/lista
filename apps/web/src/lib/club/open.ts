import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * A team to open a club through (BUG-028 review): club pages pick the club from
 * the active team, so opening a named club means switching to one of its teams.
 *
 * Returns an unarchived team of the club that the profile is on itself (the club
 * adds its owner and directors to every team), or null when the profile isn't an
 * owner or director of the club, or is on none of its teams. Runs as the viewer:
 * RLS decides what they can see.
 */
export async function findClubTeam(
  supabase: SupabaseClient<Database>,
  profileId: string,
  orgId: string
): Promise<string | null> {
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!membership) return null;

  const { data: rows } = await supabase
    .from("team_members")
    .select("team_id, teams!inner(organization_id, archived_at)")
    .eq("profile_id", profileId)
    .eq("teams.organization_id", orgId)
    .is("teams.archived_at", null)
    .limit(1);
  return rows?.[0]?.team_id ?? null;
}
