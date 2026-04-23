import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * POST /api/admin/upgrade
 *
 * Internal-only route for upgrading an org to the Club plan without going
 * through Stripe. Gated by ADMIN_UPGRADE_CODE env var — intended for
 * pre-launch testing only.
 *
 * Body: { orgId: string; code: string }
 */
export async function POST(request: Request) {
  const upgradeCode = process.env.ADMIN_UPGRADE_CODE;
  if (!upgradeCode) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, code } = body as { orgId?: string; code?: string };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  if (!code || code !== upgradeCode) {
    return NextResponse.json({ error: "invalid_code" }, { status: 403 });
  }

  const admin = adminClient();

  // Verify caller is the org owner
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("organizations")
    .update({ plan: "club", subscription_status: "active" })
    .eq("id", orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
