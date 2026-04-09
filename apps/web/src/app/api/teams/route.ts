import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { teamName, season, orgName } = body as {
    teamName?: string;
    season?: string;
    orgName?: string;
  };

  if (!teamName?.trim()) {
    return NextResponse.json({ error: "teamName is required" }, { status: 400 });
  }

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: teamId, error } = await (admin as any).rpc("create_team", {
    owner_profile_id: user.id,
    team_name: teamName.trim(),
    season: season?.trim() ?? "",
    org_name: orgName?.trim() ?? "",
  }) as { data: string | null; error: { message: string } | null };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ teamId });
}
