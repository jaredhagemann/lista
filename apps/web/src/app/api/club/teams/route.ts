import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * POST /api/club/teams
 *
 * Creates a new team within the caller's active organization.
 * Restricted to org owners and directors.
 *
 * Body: { orgId: string; teamName: string; season?: string }
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, teamName, season } = body as {
    orgId?: string;
    teamName?: string;
    season?: string;
  };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (!teamName?.trim()) {
    return NextResponse.json({ error: "teamName is required" }, { status: 400 });
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

  // Verify caller is an org owner or director
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!membership || !["owner", "director"].includes(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Create the team; owner_id set to the caller's profile
  const { error } = await admin.from("teams").insert({
    id: crypto.randomUUID(),
    organization_id: orgId,
    owner_id: profile.id,
    name: teamName.trim(),
    season: season?.trim() || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
