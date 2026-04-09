import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import type { Database } from "@/types/database";

// Accepts an invitation. Supports both mobile callers (Bearer token) and
// web callers (cookie session) via the shared resolveRequestUser helper.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = adminClient();

  // Parse body
  const body = await request.json() as {
    type: "self" | "manager";
  };

  // Fetch invitation
  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("*")
    .eq("id", id)
    .single();

  if (inviteError || !invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: "Invitation already accepted" }, { status: 410 });
  }

  // Verify the signed-in user's email matches the invitation target
  const userEmail = user.email?.trim().toLowerCase() ?? "";
  const inviteEmail = invitation.email.trim().toLowerCase();
  if (userEmail !== inviteEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.type === "manager") {
    // Accept a "manage existing player" invitation
    if (!invitation.managed_profile_id) {
      return NextResponse.json({ error: "Invalid invitation type" }, { status: 400 });
    }

    const { error: linkError } = await admin.from("profile_managers").insert({
      manager_id: user.id,
      managed_id: invitation.managed_profile_id,
      relationship: invitation.relationship ?? null,
    });

    if (linkError && linkError.code !== "23505") {
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    await admin
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ success: true });
  }

  // type === "self": accept as the signed-in user
  const { error: memberError } = await admin.from("team_members").insert({
    team_id: invitation.team_id!,
    profile_id: user.id,
    role: invitation.role as Database["public"]["Tables"]["team_members"]["Row"]["role"],
  });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  // Apply birthday/gender from invite to user profile
  const profileUpdate: Record<string, string | null> = {};
  if (invitation.birthday) profileUpdate.birthday = invitation.birthday;
  if (invitation.gender) profileUpdate.gender = invitation.gender;
  if (Object.keys(profileUpdate).length > 0) {
    await admin.from("profiles").update(profileUpdate).eq("id", user.id);
  }

  // Set active_team_id
  await admin
    .from("profiles")
    .update({ active_team_id: invitation.team_id })
    .eq("id", user.id);

  // Mark accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ success: true });
}
