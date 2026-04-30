import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Returns true if the given auth user has team-admin access to a team.
 *
 * Admin access is granted when:
 *   1. The user has an explicit team_members row with role 'coach', 'manager',
 *      or 'director', OR
 *   2. The user is an owner or director in the team's parent organization
 *      (implicit access, mirroring the is_org_admin() RLS helper behaviour).
 *
 * Resolves profiles.id from auth_user_id internally so callers only need to
 * pass the value returned by resolveRequestUser().
 *
 * @param admin      - Service-role Supabase client (bypasses RLS)
 * @param authUserId - auth.users.id of the caller (from resolveRequestUser)
 * @param teamId     - team UUID to check
 */
export async function assertTeamAdmin(
  admin: SupabaseClient<Database>,
  authUserId: string,
  teamId: string,
): Promise<boolean> {
  // profiles.id ≠ auth.users.id — resolve the mapping first
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!profile) return false;

  // 1. Explicit team_members row
  const { data: membership } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (membership && ["coach", "manager", "director"].includes(membership.role)) {
    return true;
  }

  // 2. Org-level fallback — mirrors is_org_admin(team_org_id(teamId)) in RLS.
  //    Handles directors who have implicit team access without a team_members row.
  const { data: team } = await admin
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .maybeSingle();

  if (!team?.organization_id) return false;

  const { data: orgMember } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", team.organization_id)
    .eq("profile_id", profile.id)
    .in("role", ["owner", "director"])
    .maybeSingle();

  return orgMember !== null;
}

/**
 * Resolves the calling user from the request.
 *
 * Resolution order:
 * 1. Cookie-based auth via the server Supabase client (web callers)
 * 2. Authorization: Bearer <token> header via the admin client (mobile callers)
 *
 * Returns the resolved User, or null if neither method succeeds.
 */
export async function resolveRequestUser(request: Request): Promise<User | null> {
  // 1. Cookie-based auth (web callers)
  const serverClient = await createServerClient();
  const { data: { user: cookieUser } } = await serverClient.auth.getUser();
  if (cookieUser) return cookieUser;

  // 2. Bearer token (mobile callers)
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user } } = await adminClient().auth.getUser(token);
  return user ?? null;
}
