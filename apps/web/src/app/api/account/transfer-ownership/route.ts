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

export async function POST(request: Request) {
  const token = getBearerToken(request);
  const user = await authenticateRequest(token);

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { teamId?: string; newOwnerProfileId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { teamId, newOwnerProfileId } = body;
  if (!teamId || !newOwnerProfileId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = adminClient();

  // Verify the caller owns this team
  const { data: teamRow, error: teamError } = await admin
    .from("teams")
    .select("owner_id")
    .eq("id", teamId)
    .single();

  if (teamError || !teamRow) {
    return NextResponse.json({ error: "team_not_found" }, { status: 404 });
  }

  if (teamRow.owner_id !== user.id) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  // Verify recipient is an eligible coach/manager with a real auth account on this team
  const { data: recipientMembership, error: recipientError } = await admin
    .from("team_members")
    .select("role, profiles(auth_user_id)")
    .eq("team_id", teamId)
    .eq("profile_id", newOwnerProfileId)
    .maybeSingle();

  if (recipientError || !recipientMembership) {
    return NextResponse.json({ error: "recipient_not_found" }, { status: 404 });
  }

  if (!["coach", "manager", "director"].includes(recipientMembership.role)) {
    return NextResponse.json({ error: "recipient_ineligible" }, { status: 409 });
  }

  const recipientProfile = recipientMembership.profiles as { auth_user_id: string | null } | null;
  if (!recipientProfile?.auth_user_id) {
    return NextResponse.json({ error: "recipient_ineligible" }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("teams")
    .update({ owner_id: newOwnerProfileId })
    .eq("id", teamId);

  if (updateError) {
    return NextResponse.json({ error: "transfer_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
