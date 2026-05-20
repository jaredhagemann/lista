import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { isClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/cancel
 *
 * Sets `cancel_at_period_end = true` on the org's Stripe subscription. Access
 * is unaffected until period end — `subscription_status` stays `'active'`.
 * The webhook (`customer.subscription.updated` with `cancel_at_period_end=true`)
 * is the sole writer of `subscription_cancel_at`; this route makes NO DB write.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Cancel Subscription" and
 * the cancel row of "Route Authorization & State Requirements".
 *
 * Body: { orgId: string }
 *
 * Response: { ok: true }
 *
 * Stable JSON error keys (so the UI can branch without parsing prose):
 *   not_club_plan / not_active / no_subscription /
 *   already_canceling / pending_plan_change
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId } = body as { orgId?: string };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  const admin = adminClient();

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

  const { data: org } = await admin
    .from("organizations")
    .select(
      "id, plan, subscription_status, stripe_subscription_id, subscription_cancel_at, pending_plan",
    )
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Spec precondition matrix (cancel row): plan ∈ club_*, status='active',
  // sub id present, no pending cancellation, no pending plan change. The
  // pending_plan guard exists because a Large→Small schedule and a full
  // cancellation are mutually exclusive Stripe states — cancelling on top
  // of a schedule would orphan the schedule and confuse the webhook flow.
  if (!isClubPlan(org.plan)) {
    return NextResponse.json({ error: "not_club_plan" }, { status: 400 });
  }

  if (org.subscription_status !== "active") {
    return NextResponse.json({ error: "not_active" }, { status: 400 });
  }

  if (!org.stripe_subscription_id) {
    // "Managed account" pilot/admin row — there's no Stripe sub to cancel.
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  if (org.subscription_cancel_at != null) {
    return NextResponse.json({ error: "already_canceling" }, { status: 400 });
  }

  if (org.pending_plan != null) {
    return NextResponse.json({ error: "pending_plan_change" }, { status: 400 });
  }

  await getStripe().subscriptions.update(org.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  return NextResponse.json({ ok: true });
}
