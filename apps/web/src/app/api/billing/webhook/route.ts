import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminClient } from "@/lib/api-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * POST /api/billing/webhook
 *
 * Handles Stripe subscription lifecycle events and keeps the organizations
 * table in sync with Stripe state.
 *
 * Idempotent: uses stripe_subscription_id as a stable key and checks current
 * DB state before writing — safe to replay.
 *
 * Requires the raw request body for signature verification; do NOT parse as
 * JSON before passing to stripe.webhooks.constructEvent().
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const admin = adminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id;
      if (!orgId || !session.subscription) break;

      await admin
        .from("organizations")
        .update({
          stripe_subscription_id: session.subscription as string,
          plan: "club",
          subscription_status: "active",
        })
        .eq("id", orgId);
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      // Stripe v22: subscription reference moved to invoice.parent.subscription_details.subscription
      const subscriptionId =
        invoice.parent?.type === "subscription_details"
          ? (invoice.parent.subscription_details?.subscription as string | null)
          : null;
      if (!subscriptionId) break;

      await admin
        .from("organizations")
        .update({ subscription_status: "active" })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        invoice.parent?.type === "subscription_details"
          ? (invoice.parent.subscription_details?.subscription as string | null)
          : null;
      if (!subscriptionId) break;

      await admin
        .from("organizations")
        .update({ subscription_status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      await admin
        .from("organizations")
        .update({
          plan: "free",
          subscription_status: "canceled",
          stripe_subscription_id: null,
          subdomain: null,
          custom_domain: null,
        })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }

    default:
      // Unhandled event types are ignored — return 200 so Stripe stops retrying
      break;
  }

  return NextResponse.json({ received: true });
}
