import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

export async function GET(request: Request) {
  const user = await resolveRequestUser(request);
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
        .in("role", ["coach", "manager", "director"])
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
