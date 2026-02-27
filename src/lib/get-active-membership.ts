import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type ActiveMembership =
  Database["public"]["Tables"]["team_members"]["Row"] & {
    teams: Database["public"]["Tables"]["teams"]["Row"];
  };

/**
 * Resolves the active team membership for a user.
 *
 * Priority:
 * 1. The team stored in profile.active_team_id (if the user is still a member)
 * 2. The first team membership ordered by created_at (fallback)
 *
 * Returns null if the user has no team memberships.
 */
export async function getActiveMembership(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveMembership | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", userId)
    .single();

  if (profile?.active_team_id) {
    const { data } = await supabase
      .from("team_members")
      .select("*, teams(*)")
      .eq("profile_id", userId)
      .eq("team_id", profile.active_team_id)
      .maybeSingle();

    if (data) return data as ActiveMembership;
  }

  // Fallback: return the earliest-joined team
  const { data } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return (data as ActiveMembership | null) ?? null;
}
