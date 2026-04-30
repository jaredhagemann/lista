import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * PATCH /api/club/teams/[id]/archive
 *
 * Archives or unarchives a team. When archiving, clears active_team_id on any
 * profile that currently has this team set as their active team.
 *
 * Restricted to org owners and directors.
 *
 * Body: { archive: boolean }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await params;
  const body = await request.json();
  const { archive } = body as { archive?: boolean };

  if (typeof archive !== "boolean") {
    return NextResponse.json({ error: "archive must be a boolean" }, { status: 400 });
  }

  const admin = adminClient();

  // Resolve the caller's profile
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  // Fetch the team to get its org
  const { data: team } = await admin
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .single();

  if (!team?.organization_id) {
    return NextResponse.json({ error: "team_not_found" }, { status: 404 });
  }

  // Verify caller is an org owner or director
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", team.organization_id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!membership || !["owner", "director"].includes(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (archive) {
    // Clear active_team_id for all profiles that have this team as their active team
    await admin
      .from("profiles")
      .update({ active_team_id: null })
      .eq("active_team_id", teamId);
  }

  const { error } = await admin
    .from("teams")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", teamId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
