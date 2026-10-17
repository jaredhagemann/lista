import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadActiveContext } from "@/lib/active-context";

export type ActiveMembership =
  Database["public"]["Tables"]["team_members"]["Row"] & {
    teams: Database["public"]["Tables"]["teams"]["Row"];
  };

/**
 * The profile this device views as: the account's own, or one it manages
 * (docs/specs/device-local-active-context.md). Checked, never taken from a
 * cookie as it is (D6).
 */
export async function getActiveProfileId(supabase: SupabaseClient<Database>, userId: string): Promise<string> {
  return (await loadActiveContext(supabase, userId)).activeProfileId;
}

/**
 * The membership this device views: the active profile on the active team.
 * Null when none of the account's people is on a team.
 */
export async function getActiveMembership(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveMembership | null> {
  return (await loadActiveContext(supabase, userId)).activeMembership as ActiveMembership | null;
}
