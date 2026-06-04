import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * GET /api/billing/status
 *
 * Returns the full billing snapshot for the caller's org — used by the Plan
 * tab and Club Billing UI to drive the trial / active / downgrading /
 * canceling / past-due / canceled badge matrix in the spec, plus the action-
 * button visibility rules (add/manage payment method, cancel, reactivate,
 * managed-account note).
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Club Billing Page" matrix
 * and the status row of "Route Authorization & State Requirements"
 * (owner or director — director read access is what the spec calls out as
 * distinct from the mutation routes which are owner-only).
 *
 * Org resolution: explicit `?orgId=` query param if provided; otherwise the
 * caller's active org is derived from `profiles.active_team_id →
 * teams.organization_id`. The org-level role check (owner OR director) is
 * authoritative — being a coach/manager/parent/player on a team in the org
 * is NOT enough to read billing detail.
 *
 * Response shape:
 *   {
 *     orgId: string,
 *     plan: 'free' | 'club_small' | 'club_large' | string,
 *     subscriptionStatus: 'trialing'|'active'|'past_due'|'canceled'|null,
 *     teamLimit: number | null,           // null = unlimited (club_large)
 *     trialEndsAt: string | null,
 *     trialDaysRemaining: number | null,  // null when not trialing; clamped >= 0
 *     pendingPlan: string | null,
 *     pendingPlanAt: string | null,
 *     subscriptionCancelAt: string | null,
 *     hasStripeCustomer: boolean,
 *     hasStripeSubscription: boolean,
 *   }
 */
export async function GET(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const explicitOrgId = url.searchParams.get("orgId");

  const admin = adminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, active_team_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  let orgId = explicitOrgId;

  if (!orgId) {
    if (!profile.active_team_id) {
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
    orgId = team.organization_id;
  }

  // Org-level role gate — spec auth matrix: owner OR director.
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "director")
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: org, error } = await admin
    .from("organizations")
    .select(
      "id, plan, subscription_status, team_limit, trial_ends_at, pending_plan, pending_plan_at, subscription_cancel_at, stripe_customer_id, stripe_subscription_id",
    )
    .eq("id", orgId)
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Days remaining is only meaningful when the org is currently trialing —
  // an admin-upgraded org has `trial_ends_at` stamped at upgrade time as the
  // permanent "trial consumed" gate, not as a displayed value.
  let trialDaysRemaining: number | null = null;
  if (org.subscription_status === "trialing" && org.trial_ends_at) {
    const msRemaining = new Date(org.trial_ends_at).getTime() - Date.now();
    trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / 86_400_000));
  }

  return NextResponse.json({
    orgId: org.id,
    plan: org.plan,
    subscriptionStatus: org.subscription_status,
    teamLimit: org.team_limit,
    trialEndsAt: org.trial_ends_at,
    trialDaysRemaining,
    pendingPlan: org.pending_plan,
    pendingPlanAt: org.pending_plan_at,
    subscriptionCancelAt: org.subscription_cancel_at,
    hasStripeCustomer: org.stripe_customer_id != null,
    hasStripeSubscription: org.stripe_subscription_id != null,
  });
}
