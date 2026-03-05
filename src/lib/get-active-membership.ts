import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type ActiveMembership =
  Database["public"]["Tables"]["team_members"]["Row"] & {
    teams: Database["public"]["Tables"]["teams"]["Row"];
  };

/**
 * Returns the active_profile_id from the session cookie, falling back to the
 * user's own profile ID. Use this anywhere you need to know which profile the
 * current session is "viewing as".
 */
export async function getActiveProfileId(userId: string): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get("active_profile_id")?.value ?? userId;
}

/**
 * Resolves the active team membership for the current session.
 *
 * Reads the active_profile_id cookie to determine which profile is active
 * (own or managed), then resolves the active team from that profile's
 * active_team_id, falling back to the first membership.
 *
 * Returns null if the active profile has no team memberships.
 */
export async function getActiveMembership(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveMembership | null> {
  const activeProfileId = await getActiveProfileId(userId);

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  if (profile?.active_team_id) {
    const { data } = await supabase
      .from("team_members")
      .select("*, teams(*)")
      .eq("profile_id", activeProfileId)
      .eq("team_id", profile.active_team_id)
      .maybeSingle();

    if (data) return data as ActiveMembership;
  }

  // Fallback: return the earliest-joined team for the active profile
  const { data } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", activeProfileId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return (data as ActiveMembership | null) ?? null;
}
