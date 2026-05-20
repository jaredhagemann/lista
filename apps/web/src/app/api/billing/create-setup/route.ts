import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { isClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/create-setup
 *
 * Creates a Stripe Checkout session in `mode: 'setup'` so a trialing club
 * owner can save a payment method without yet starting a paid subscription.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Adding Payment Method
 * During Trial" and "Route Authorization & State Requirements".
 *
 * The setup session has no `customer_update` flag — Stripe's `customer_update`
 * parameter controls customer address/name fields, NOT the invoice default
 * payment method. The webhook (`checkout.session.completed` with
 * `session.mode === 'setup'`) is what sets
 * `invoice_settings.default_payment_method` on the customer; this route only
 * creates the session.
 *
 * Body: { orgId: string }
 *
 * Response: { url: string } — redirect the user to this URL.
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
    .select("id, name, plan, subscription_status, stripe_customer_id")
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Spec precondition: caller is owner, plan ∈ {club_small, club_large},
  // subscription_status = 'trialing'. Distinct error codes so the UI can route
  // each failure (e.g. send free orgs back to start-trial / checkout).
  if (!isClubPlan(org.plan)) {
    return NextResponse.json({ error: "not_club_plan" }, { status: 400 });
  }

  if (org.subscription_status !== "trialing") {
    return NextResponse.json({ error: "not_trialing" }, { status: 400 });
  }

  // Create the Stripe customer if this org doesn't have one yet. Trials don't
  // require a customer to be created up-front (start-trial makes no Stripe
  // call), so the first payment-method setup is usually where the customer is
  // born. Persist immediately so a retried setup reuses the same id.
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
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // mode:'setup' — no line items, no subscription. The webhook retrieves the
  // resulting SetupIntent and writes `invoice_settings.default_payment_method`
  // on the customer so the trial-expiration cron can charge it on day 91.
  //
  // Idempotency key is scoped to the org: repeated clicks within Stripe's 24h
  // window return the same setup session URL. Setup sessions are tier-
  // independent (no price), so no tier suffix is needed.
  const session = await getStripe().checkout.sessions.create(
    {
      customer: customerId,
      mode: "setup",
      metadata: { org_id: orgId },
      success_url: `${appUrl}/dashboard/club/billing?setup=success`,
      cancel_url: `${appUrl}/dashboard/club/billing?setup=canceled`,
    },
    { idempotencyKey: `setup-${orgId}` },
  );

  return NextResponse.json({ url: session.url });
}
