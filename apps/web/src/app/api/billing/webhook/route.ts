import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";
import { getStripe } from "@/lib/stripe";
import { planFromPriceId, teamLimitForPlan } from "@/lib/billing";

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook entrypoint. Keeps the `organizations` row in sync with Stripe
 * across the full subscription lifecycle the spec defines (start-trial bypass,
 * payment-method setup, direct upgrades, deferred Large → Small schedules,
 * cancellation pending/final, tier mapping).
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Webhook Events" and
 * "Trial Expiration (Day 91 Cron)" (`customer.subscription.created` is a
 * deliberate no-op so the cron's `subscriptions.create` doesn't double-write).
 *
 * Idempotency: every write is shaped as "set DB to the value observed in the
 * Stripe event" — Stripe may replay events, and conditional Stripe Schedules
 * fire `customer.subscription.updated` more than once for a single phase
 * transition, so the same value being written twice must be safe.
 *
 * Requires the raw request body for signature verification — do NOT parse as
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
    event = getStripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const admin = adminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id;
      if (!orgId) break;

      if (session.mode === "setup") {
        await handleSetupSession(admin, session, orgId);
      } else if (session.mode === "subscription") {
        await handleSubscriptionSession(admin, session, orgId);
      }
      break;
    }

    case "customer.subscription.created": {
      // Spec: no-op. Activation is driven by `checkout.session.completed`
      // (direct upgrade) or the trial-expiration cron (immediate write after
      // `subscriptions.create`). Writing here would either duplicate that
      // work or race the cron's "skip if stripe_subscription_id != null" guard.
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const updates: Record<string, unknown> = {};

      // cancel_at_period_end → subscription_cancel_at. Always assert the
      // observed state: `true` means a pending cancellation (write the
      // timestamp), `false` means active / reactivated (clear). Spec is
      // explicit that `subscription_status` stays `'active'` through this
      // window — access is unaffected.
      if (sub.cancel_at_period_end) {
        updates.subscription_cancel_at = sub.cancel_at
          ? new Date(sub.cancel_at * 1000).toISOString()
          : null;
      } else {
        updates.subscription_cancel_at = null;
      }

      // Price ID → plan / team_limit. Idempotent: when the price hasn't
      // changed, `planFromPriceId` returns the same plan and we write a no-op.
      // When the price changed (direct Small → Large via change-plan, or a
      // Subscription Schedule executing Large → Small at period end), the
      // mapping flips the row to the new tier.
      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const mapped = planFromPriceId(priceId);
      if (mapped) {
        updates.plan = mapped.plan;
        updates.team_limit = mapped.teamLimit;
        // Schedule executed: clear the "pending downgrade" markers. Only the
        // small-tier price is ever the target of a deferred change (the DB
        // CHECK restricts pending_plan to 'club_small'), so this branch is
        // the unambiguous "schedule fired" signal in the webhook. The
        // `subscription_schedule.released` event will clear stripe_schedule_id
        // separately.
        if (mapped.plan === "club_small") {
          updates.pending_plan = null;
          updates.pending_plan_at = null;
        }
      }

      await admin
        .from("organizations")
        .update(updates)
        .eq("stripe_subscription_id", sub.id);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;

      // Read the current row first so we know which Redis cache keys to bust
      // for the white-label tenant resolver.
      const { data: currentOrg } = await admin
        .from("organizations")
        .select("subdomain, subdomain_status, custom_domain")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();

      // Subdomain is quarantined (not cleared) — the value stays on the row so
      // no other org can claim it for 180 days. `resolveTenant()` only returns
      // a tenant context when subdomain_status = 'active', so the host
      // immediately stops serving the white-label experience after the
      // invalidation below.
      await admin
        .from("organizations")
        .update({
          plan: "free",
          team_limit: teamLimitForPlan("free"),
          subscription_status: "canceled",
          subscription_cancel_at: null,
          subdomain_status: currentOrg?.subdomain ? "quarantined" : null,
          subdomain_quarantined_at: currentOrg?.subdomain
            ? new Date().toISOString()
            : null,
          custom_domain: null,
        })
        .eq("stripe_subscription_id", sub.id);

      const invalidations: Promise<void>[] = [];
      if (currentOrg?.subdomain) {
        invalidations.push(
          invalidateTenantCache(`${currentOrg.subdomain}.lista.team`),
        );
      }
      if (currentOrg?.custom_domain) {
        invalidations.push(invalidateTenantCache(currentOrg.custom_domain));
      }
      await Promise.all(invalidations);
      break;
    }

    case "subscription_schedule.released": {
      // Phase executed normally; `customer.subscription.updated` already wrote
      // plan / team_limit / pending_*. Clear the schedule pointer so a fresh
      // downgrade can be scheduled later without colliding.
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const orgId = schedule.metadata?.org_id;
      if (!orgId) break;

      await admin
        .from("organizations")
        .update({ stripe_schedule_id: null })
        .eq("id", orgId);
      break;
    }

    case "subscription_schedule.canceled": {
      // Schedule was cancelled before executing (typically via re-upgrade in
      // change-plan Branch 4). Clear all three "pending downgrade" markers.
      // `customer.subscription.updated` is too ambiguous to use here — many
      // ordinary mutations fire that event, but `subscription_schedule.canceled`
      // is uniquely the cancellation signal.
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const orgId = schedule.metadata?.org_id;
      if (!orgId) break;

      await admin
        .from("organizations")
        .update({
          pending_plan: null,
          pending_plan_at: null,
          stripe_schedule_id: null,
        })
        .eq("id", orgId);
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      // Stripe v22: subscription reference moved to
      // invoice.parent.subscription_details.subscription.
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

    default:
      // Unhandled event types are ignored — return 200 so Stripe stops retrying.
      break;
  }

  return NextResponse.json({ received: true });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof adminClient>;

/**
 * `checkout.session.completed` with `mode: 'subscription'` — paid upgrade or
 * re-upgrade after cancellation. Reads the subscription's first price ID,
 * maps it to a club tier via `planFromPriceId`, and writes the full activation
 * payload (plan + team_limit + subscription_status + customer/subscription
 * ids), plus the subdomain-restore branch when the org was previously
 * quarantined.
 */
async function handleSubscriptionSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  orgId: string,
): Promise<void> {
  const subscriptionId = session.subscription as string | null;
  if (!subscriptionId) return;

  const { data: currentOrg } = await admin
    .from("organizations")
    .select(
      "subdomain, subdomain_status, stripe_customer_id, subscription_status",
    )
    .eq("id", orgId)
    .maybeSingle();

  // Guard: only activate if the org's stripe_customer_id matches this session's
  // customer AND the org is not already in a 'canceled' state. The
  // create-checkout route clears `subscription_status` to null on re-upgrade
  // (stale-canceled reset), so a 'canceled' here would be a stale row Stripe
  // is trying to revive — refuse rather than partially write.
  if (
    !currentOrg ||
    currentOrg.stripe_customer_id !== (session.customer as string) ||
    currentOrg.subscription_status === "canceled"
  ) {
    return;
  }

  // Resolve the tier from the subscription's first price ID. The subscription
  // is fresh, so it has exactly one item with the price the customer just
  // bought. `planFromPriceId` returns null only for an unrecognised price ID
  // (e.g. a legacy `STRIPE_CLUB_PRICE_ID` event arriving after the env vars
  // were retired); refuse to write garbage in that case.
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const mapped = planFromPriceId(priceId);
  if (!mapped) return;

  // Restore the subdomain if it was quarantined (re-upgrade within the 180-day
  // hold window). For first-time activations the field is absent and stays
  // unchanged.
  const subdomainRestore =
    currentOrg.subdomain_status === "quarantined"
      ? { subdomain_status: "active", subdomain_quarantined_at: null }
      : {};

  await admin
    .from("organizations")
    .update({
      plan: mapped.plan,
      team_limit: mapped.teamLimit,
      stripe_subscription_id: subscriptionId,
      subscription_status: "active",
      ...subdomainRestore,
    })
    .eq("id", orgId);

  if (
    "subdomain_status" in subdomainRestore &&
    subdomainRestore.subdomain_status === "active" &&
    currentOrg.subdomain
  ) {
    await invalidateTenantCache(`${currentOrg.subdomain}.lista.team`);
  }
}

/**
 * `checkout.session.completed` with `mode: 'setup'` — owner added a payment
 * method during the trial. Retrieves the SetupIntent to get the payment method
 * id, sets it as the customer's `invoice_settings.default_payment_method` so
 * the day-91 cron's `subscriptions.create` charges it without needing an
 * explicit `default_payment_method` argument, and writes
 * `stripe_customer_id` on the org if not already set.
 *
 * The cron determines whether the customer has a payment method by reading
 * `customer.invoice_settings.default_payment_method`, so writing it here is
 * the load-bearing operation — an attached card that isn't the invoice default
 * will not be charged by a fresh subscription.
 */
async function handleSetupSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  orgId: string,
): Promise<void> {
  const setupIntentId = session.setup_intent as string | null;
  const customerId = session.customer as string | null;
  if (!setupIntentId || !customerId) return;

  const setupIntent = await getStripe().setupIntents.retrieve(setupIntentId);
  const paymentMethod =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? null;
  if (!paymentMethod) return;

  await getStripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethod },
  });

  // Persist the customer id idempotently. The create-setup route writes it on
  // creation, but Stripe's setup-session flow can also be invoked outside
  // create-setup (e.g. legacy seed data) — writing here guarantees the column
  // is populated by the time the cron runs.
  await admin
    .from("organizations")
    .update({ stripe_customer_id: customerId })
    .eq("id", orgId);
}
