import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/types/database";

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
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

function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function checkOwnedTeams(
  userId: string
): Promise<{ data: { name: string }[] } | { error: true }> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("teams")
    .select("name")
    .eq("owner_id", userId);
  if (error) return { error: true };
  return { data };
}

export async function GET(request: Request) {
  const token = getBearerToken(request);
  const user = await authenticateRequest(token);

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await checkOwnedTeams(user.id);
  if ("error" in result) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }

  if (result.data.length > 0) {
    return NextResponse.json(
      { error: "owns_teams", teams: result.data.map((t) => t.name) },
      { status: 409 }
    );
  }

  return NextResponse.json({ eligible: true });
}

export async function DELETE(request: Request) {
  const token = getBearerToken(request);
  const user = await authenticateRequest(token);

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Re-check ownership to guard against race between eligibility check and confirmation
  const result = await checkOwnedTeams(user.id);
  if ("error" in result) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }

  if (result.data.length > 0) {
    return NextResponse.json(
      { error: "owns_teams", teams: result.data.map((t) => t.name) },
      { status: 409 }
    );
  }

  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
