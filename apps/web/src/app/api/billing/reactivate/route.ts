import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { isClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/reactivate
 *
 * Reverses a pending cancellation by clearing `cancel_at_period_end` on the
 * org's Stripe subscription. The webhook (`customer.subscription.updated`
 * with `cancel_at_period_end=false`) is the sole writer that clears
 * `subscription_cancel_at`; this route makes NO DB write.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Reactivation" and the
 * reactivate row of "Route Authorization & State Requirements".
 *
 * Body: { orgId: string }
 *
 * Response: { ok: true }
 *
 * Stable JSON error keys (so the UI can branch without parsing prose):
 *   not_club_plan / not_active / no_subscription / not_canceling
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
      "id, plan, subscription_status, stripe_subscription_id, subscription_cancel_at",
    )
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Spec precondition matrix (reactivate row): plan ∈ club_*, status='active',
  // sub id present, AND a pending cancellation is already in flight. Calling
  // reactivate on an org without a pending cancel would be a no-op in Stripe
  // but a confusing UX — reject so the client surfaces the state mismatch.
  if (!isClubPlan(org.plan)) {
    return NextResponse.json({ error: "not_club_plan" }, { status: 400 });
  }

  if (org.subscription_status !== "active") {
    return NextResponse.json({ error: "not_active" }, { status: 400 });
  }

  if (!org.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  if (org.subscription_cancel_at == null) {
    return NextResponse.json({ error: "not_canceling" }, { status: 400 });
  }

  await getStripe().subscriptions.update(org.stripe_subscription_id, {
    cancel_at_period_end: false,
  });

  return NextResponse.json({ ok: true });
}
