import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient, assertTeamAdmin } from "@/lib/api-auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await resolveRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = adminClient();

  const { data: invitation } = await admin
    .from("invitations")
    .select("team_id, accepted_at")
    .eq("id", id)
    .single();

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.accepted_at) {
    return NextResponse.json(
      { error: "Invitation already accepted" },
      { status: 400 }
    );
  }

  // Verify caller is a team admin (explicit row or org-level director/owner)
  const isTeamAdmin = await assertTeamAdmin(admin, user.id, invitation.team_id!);
  if (!isTeamAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await admin.from("invitations").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
