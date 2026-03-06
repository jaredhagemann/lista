import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

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

  // Verify caller is a team admin
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", invitation.team_id!)
    .eq("profile_id", user.id)
    .single();

  if (!membership || !["coach", "manager"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await admin.from("invitations").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
