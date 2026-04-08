import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/types/database";

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function authenticateRequest(token: string | null) {
  if (!token) return null;
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

export async function GET(request: Request) {
  const token = getBearerToken(request);
  const user = await authenticateRequest(token);

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = adminClient();

  const { data: ownedTeams, error: teamsError } = await admin
    .from("teams")
    .select("id, name")
    .eq("owner_id", user.id);

  if (teamsError) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // For each owned team, fetch eligible admins: coaches/managers with real auth accounts
  const teams = await Promise.all(
    (ownedTeams ?? []).map(async (team) => {
      const { data: members, error: membersError } = await admin
        .from("team_members")
        .select("profile_id, role, profiles(first_name, last_name, auth_user_id)")
        .eq("team_id", team.id)
        .in("role", ["coach", "manager"])
        .neq("profile_id", user.id);

      if (membersError) {
        return { id: team.id, name: team.name, eligibleAdmins: [] };
      }

      const eligibleAdmins = (members ?? [])
        .filter((m) => {
          const p = m.profiles as { auth_user_id: string | null } | null;
          return p?.auth_user_id != null;
        })
        .map((m) => {
          const p = m.profiles as {
            first_name: string | null;
            last_name: string | null;
          } | null;
          return {
            profileId: m.profile_id,
            name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown",
            role: m.role,
          };
        });

      return { id: team.id, name: team.name, eligibleAdmins };
    })
  );

  return NextResponse.json({ teams });
}
