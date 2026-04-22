import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { stripe } from "@/lib/stripe";

/**
 * POST /api/billing/create-checkout
 *
 * Creates a Stripe Checkout Session for the Club plan upgrade.
 * Restricted to org owners (organization_members.role = 'owner').
 *
 * Body: { orgId: string }
 *
 * Response: { url: string } — redirect the user to this URL
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

  if (org.plan === "club") {
    return NextResponse.json({ error: "already_subscribed" }, { status: 409 });
  }

  // Reuse existing Stripe customer or create a new one
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
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
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    if (existing.data.length > 0) {
      return NextResponse.json({ error: "already_subscribed" }, { status: 409 });
    }
  }

  // Re-subscribing after a previous cancellation: reset the stale canceled state
  // so the checkout.session.completed guard's subscription_status check will pass.
  if (org.subscription_status === "canceled") {
    await admin
      .from("organizations")
      .update({ stripe_subscription_id: null, subscription_status: null })
      .eq("id", orgId);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Idempotency key scoped to this org: concurrent requests (e.g. double-click)
  // get back the same Stripe session instead of creating duplicate subscriptions.
  // The key is valid for 24 hours — matches Stripe Checkout Session expiry.
  const session = await stripe.checkout.sessions.create(
    {
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_CLUB_PRICE_ID!,
          quantity: 1,
        },
      ],
      metadata: { org_id: orgId },
      success_url: `${appUrl}/dashboard/settings?billing=success`,
      cancel_url: `${appUrl}/dashboard/settings?billing=canceled`,
    },
    { idempotencyKey: `checkout-${orgId}` },
  );

  return NextResponse.json({ url: session.url });
}
