import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Whether the profile is a director of the team's club, or its owner while it's
 * on a Club plan (BUG-046). A standalone team's owner isn't one. The roster's
 * role editor offers Director for them, and only them: the database refuses a
 * `director` row for anyone else. Needs the service-role client; it's the
 * same check the database makes.
 */
export async function isClubAdminOfTeam(
  admin: SupabaseClient<Database>,
  teamId: string,
  profileId: string
): Promise<boolean> {
  const { data } = await admin.rpc("club_admin_of_team", {
    p_team_id: teamId,
    p_profile_id: profileId,
  });
  return data === true;
}
