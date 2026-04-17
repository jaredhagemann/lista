import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * GET /api/billing/status
 *
 * Returns the current billing plan and subscription status for the caller's
 * active organization. The active org is resolved from profiles.active_team_id
 * → teams.organization_id.
 *
 * Response:
 *   { plan: 'free' | 'club', subscriptionStatus: string | null, orgId: string }
 */
export async function GET(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = adminClient();

  // Resolve the caller's active org via their active team
  const { data: profile } = await admin
    .from("profiles")
    .select("id, active_team_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile?.active_team_id) {
    return NextResponse.json({ error: "no_active_team" }, { status: 404 });
  }

  const { data: team } = await admin
    .from("teams")
    .select("organization_id")
    .eq("id", profile.active_team_id)
    .single();

  if (!team?.organization_id) {
    return NextResponse.json({ error: "no_organization" }, { status: 404 });
  }

  // Verify caller is still an active member of this team.
  // active_team_id is a stale pointer — it is not cleared when a user is removed
  // from a team, so we must gate on current team_members state, not the pointer.
  const { data: membership } = await admin
    .from("team_members")
    .select("profile_id")
    .eq("team_id", profile.active_team_id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  }

  const { data: org, error } = await admin
    .from("organizations")
    .select("id, plan, subscription_status, stripe_customer_id")
    .eq("id", team.organization_id)
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    orgId: org.id,
    plan: org.plan,
    subscriptionStatus: org.subscription_status,
    hasStripeCustomer: org.stripe_customer_id != null,
  });
}
