import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";

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
      const newSubscriptionId = session.subscription as string;
      if (!orgId || !newSubscriptionId) break;

      // Guard against out-of-order retries: only activate if the org's
      // stripe_customer_id matches this session's customer (prevents cross-org
      // contamination) AND the org is not already in a 'canceled' state
      // (prevents a retried old checkout event from resurrecting a downgraded org).
      // The conditional update is atomic — if 0 rows are updated, the guard fired
      // and we safely ignore the event.
      await admin
        .from("organizations")
        .update({
          stripe_subscription_id: newSubscriptionId,
          plan: "club",
          subscription_status: "active",
        })
        .eq("id", orgId)
        .eq("stripe_customer_id", session.customer as string)
        .or("subscription_status.is.null,subscription_status.neq.canceled");
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

      // Fetch current subdomain/custom_domain before clearing so we know which
      // Redis cache keys to bust. Without this, the old tenant:{hostname} entries
      // would remain valid until TTL expiry, letting the downgraded org continue
      // resolving as a club tenant from the cache.
      const { data: currentOrg } = await admin
        .from("organizations")
        .select("subdomain, custom_domain")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

      // Intentionally do NOT clear stripe_subscription_id here. Keeping it set
      // allows the checkout.session.completed guard to detect that a retried old
      // checkout event would resurrect an already-canceled org and block it.
      // The subscription_status = 'canceled' sentinel is what the guard checks.
      // stripe_subscription_id is reset to null only in create-checkout, when the
      // org owner explicitly initiates a new subscription.
      await admin
        .from("organizations")
        .update({
          plan: "free",
          subscription_status: "canceled",
          subdomain: null,
          custom_domain: null,
        })
        .eq("stripe_subscription_id", subscription.id);

      // Invalidate tenant cache so the downgrade takes effect immediately
      // instead of waiting for the 60s TTL to expire.
      const invalidations: Promise<void>[] = [];
      if (currentOrg?.subdomain) {
        invalidations.push(invalidateTenantCache(`${currentOrg.subdomain}.lista.team`));
      }
      if (currentOrg?.custom_domain) {
        invalidations.push(invalidateTenantCache(currentOrg.custom_domain));
      }
      await Promise.all(invalidations);

      break;
    }

    default:
      // Unhandled event types are ignored — return 200 so Stripe stops retrying
      break;
  }

  return NextResponse.json({ received: true });
}
