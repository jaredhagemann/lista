import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Public endpoint — no auth required. Used by the mobile app to fetch invite
// details before the user is signed in.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: invitation, error } = await admin
    .from("invitations")
    .select("id, email, role, managed_profile_id, accepted_at, teams(name)")
    .eq("id", id)
    .single();

  if (error || !invitation) {
    return NextResponse.json({ error: "Invalid invitation" }, { status: 404 });
  }

  if (invitation.accepted_at) {
    return NextResponse.json({ error: "Invitation already accepted" }, { status: 410 });
  }

  const teamName = (invitation.teams as { name: string } | null)?.name ?? "Unknown Team";

  return NextResponse.json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    teamName,
    // If managed_profile_id is set, this is a "manage existing player" invite
    isManagerInvite: !!invitation.managed_profile_id,
  });
}
