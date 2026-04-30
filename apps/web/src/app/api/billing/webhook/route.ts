import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";
import { getStripe } from "@/lib/stripe";

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
    event = getStripe().webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
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

      // Fetch current org to check whether there is a quarantined subdomain
      // that should be restored on re-upgrade (within the 180-day hold window).
      const { data: currentOrg } = await admin
        .from("organizations")
        .select("subdomain, subdomain_status, stripe_customer_id, subscription_status")
        .eq("id", orgId)
        .maybeSingle();

      // Guard: only activate if the org's stripe_customer_id matches this
      // session's customer AND the org is not already in a 'canceled' state.
      if (
        !currentOrg ||
        currentOrg.stripe_customer_id !== (session.customer as string) ||
        currentOrg.subscription_status === "canceled"
      ) {
        break;
      }

      // If the org has a quarantined subdomain (re-upgrading within the 180-day
      // hold window), restore it. Otherwise leave subdomain_status unchanged.
      const subdomainRestore =
        currentOrg.subdomain_status === "quarantined"
          ? { subdomain_status: "active", subdomain_quarantined_at: null }
          : {};

      await admin
        .from("organizations")
        .update({
          stripe_subscription_id: newSubscriptionId,
          plan: "club",
          subscription_status: "active",
          ...subdomainRestore,
        })
        .eq("id", orgId);

      // If subdomain was restored, bust the cache so it resolves immediately.
      if (subdomainRestore.subdomain_status === "active" && currentOrg.subdomain) {
        await invalidateTenantCache(`${currentOrg.subdomain}.lista.team`);
      }
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

      // Fetch current subdomain/custom_domain before updating so we know which
      // Redis cache keys to bust.
      const { data: currentOrg } = await admin
        .from("organizations")
        .select("subdomain, subdomain_status, custom_domain")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

      // Subdomain is quarantined (not cleared) per spec §1.10. The value stays on
      // the row so no other org can claim it for 180 days. resolveTenant() only
      // returns a tenant context when subdomain_status = 'active', so the host
      // immediately stops serving the white-label experience after cache bust.
      await admin
        .from("organizations")
        .update({
          plan: "free",
          subscription_status: "canceled",
          subdomain_status: currentOrg?.subdomain ? "quarantined" : null,
          subdomain_quarantined_at: currentOrg?.subdomain ? new Date().toISOString() : null,
          custom_domain: null,
        })
        .eq("stripe_subscription_id", subscription.id);

      // Invalidate tenant cache so the downgrade takes effect immediately.
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
