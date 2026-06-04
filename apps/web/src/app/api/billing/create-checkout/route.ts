import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { priceIdForPlan } from "@/lib/billing";
import { isClubPlan, type ClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/create-checkout
 *
 * Creates a Stripe Checkout subscription session for a direct paid upgrade
 * (Free → Club Small/Large) or a re-upgrade after a previous cancellation. The
 * trial flow does NOT pass through here — trials are started via
 * POST /api/billing/start-trial without any Stripe interaction.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Route Authorization & State
 * Requirements" and "Re-subscribing after cancellation".
 *
 * Body: { orgId: string; plan: 'club_small' | 'club_large' }
 *
 * Allowed states (auth matrix in the spec):
 *   - plan = 'free' (any subscription_status, including null and 'canceled'), OR
 *   - plan = club_small | club_large WITH subscription_status = 'canceled'.
 * Anything else means the org is currently subscribed/trialing/past_due and
 * must use change-plan instead.
 *
 * Response: { url: string } — redirect the user to this URL.
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, plan } = body as { orgId?: string; plan?: string };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  if (!isClubPlan(plan)) {
    return NextResponse.json(
      { error: "plan must be 'club_small' or 'club_large'" },
      { status: 400 },
    );
  }
  const tierPlan: ClubPlan = plan;

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
    .single();

  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id, plan, subscription_status")
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Spec precondition: plan='free' (any status), or club_* explicitly canceled.
  // The legacy `org.plan === 'club'` guard was dead code after migration
  // 20260519000000 retired that value; this compound check replaces it.
  const eligible =
    org.plan === "free" ||
    (isClubPlan(org.plan) && org.subscription_status === "canceled");
  if (!eligible) {
    return NextResponse.json({ error: "already_subscribed" }, { status: 400 });
  }

  // Reuse existing Stripe customer or create a new one
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await getStripe().customers.create({
      name: org.name,
      metadata: { org_id: orgId },
    });
    customerId = customer.id;

    await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", orgId);
  } else {
    // Customer already exists — check Stripe directly for active subscriptions
    // so we don't open a second checkout session before the webhook has landed.
    const existing = await getStripe().subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    if (existing.data.length > 0) {
      return NextResponse.json(
        { error: "already_subscribed" },
        { status: 400 },
      );
    }
  }

  // Re-subscribing after a previous cancellation: reset the stale canceled
  // state so the checkout.session.completed handler's writes don't collide
  // with the existing 'canceled' marker on the row.
  if (org.subscription_status === "canceled") {
    await admin
      .from("organizations")
      .update({ stripe_subscription_id: null, subscription_status: null })
      .eq("id", orgId);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Idempotency key is scoped to (org, tier): concurrent requests for the same
  // tier (e.g. double-click) return the same session, but a follow-up checkout
  // for a different tier within Stripe's 24h idempotency window must produce a
  // fresh session for the new price.
  const session = await getStripe().checkout.sessions.create(
    {
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price: priceIdForPlan(tierPlan),
          quantity: 1,
        },
      ],
      metadata: { org_id: orgId },
      success_url: `${appUrl}/dashboard/settings?billing=success`,
      cancel_url: `${appUrl}/dashboard/settings?billing=canceled`,
    },
    { idempotencyKey: `checkout-${orgId}-${tierPlan}` },
  );

  return NextResponse.json({ url: session.url });
}
