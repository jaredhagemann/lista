import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { priceIdForPlan, teamLimitForPlan } from "@/lib/billing";
import { isClubPlan, type ClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/change-plan
 *
 * Handles the four mid-subscription tier transitions the spec defines:
 *
 *   1. Trial Small ↔ Large           — DB-only; plan + team_limit flip
 *                                       immediately, trial period unchanged.
 *   2. Active Small → Large          — immediate Stripe price swap via
 *                                       subscriptions.update; webhook writes
 *                                       plan + team_limit.
 *   3. Active Large → Small          — deferred via Subscription Schedule;
 *                                       this route writes pending_plan /
 *                                       pending_plan_at / stripe_schedule_id,
 *                                       NOT plan / team_limit (webhook does
 *                                       that when the schedule executes).
 *   4. Re-upgrade Large (with a      — cancels the pending Subscription
 *      pending Large → Small)         Schedule; webhook clears pending_*.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Club Small → Club Large
 * (upgrade…)", "Club Large → Club Small (downgrade)", and the change-plan row
 * of "Route Authorization & State Requirements".
 *
 * Body: { orgId: string; plan: 'club_small' | 'club_large' }
 *
 * Response: { ok: true; kind: 'trial_plan_changed' | 'subscription_updated' |
 *             'downgrade_scheduled' | 'schedule_canceled';
 *             pendingPlanAt?: string }
 *
 * Stable JSON error keys (so the UI can branch without parsing prose):
 *   not_club_plan / not_active_or_trialing / no_subscription /
 *   same_plan / pending_plan_change
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
  const requestedPlan: ClubPlan = plan;

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
      "id, plan, subscription_status, stripe_subscription_id, stripe_schedule_id, pending_plan",
    )
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Spec precondition matrix (change-plan row): plan ∈ club_*, status ∈
  // {trialing, active}, and on active the sub id must exist.
  if (!isClubPlan(org.plan)) {
    return NextResponse.json({ error: "not_club_plan" }, { status: 400 });
  }

  if (
    org.subscription_status !== "trialing" &&
    org.subscription_status !== "active"
  ) {
    return NextResponse.json(
      { error: "not_active_or_trialing" },
      { status: 400 },
    );
  }

  if (
    org.subscription_status === "active" &&
    !org.stripe_subscription_id
  ) {
    // Active-without-Stripe-id is the "Managed account" pilot row — change-plan
    // can't act on it because there's nothing in Stripe to mutate.
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  const isSamePlan = org.plan === requestedPlan;
  const hasPendingSchedule = org.stripe_schedule_id != null;

  // Branch 4: re-upgrade cancels a pending Large → Small downgrade. The DB
  // CHECK constraint restricts pending_plan to 'club_small', so the only
  // valid configuration here is current='club_large' with the schedule
  // pending the downgrade — requesting Large again means "undo the
  // pending downgrade". The webhook clears pending_plan / pending_plan_at /
  // stripe_schedule_id when subscription_schedule.canceled fires.
  if (isSamePlan && hasPendingSchedule) {
    await getStripe().subscriptionSchedules.cancel(org.stripe_schedule_id!);
    return NextResponse.json({ ok: true, kind: "schedule_canceled" });
  }

  if (isSamePlan) {
    return NextResponse.json({ error: "same_plan" }, { status: 400 });
  }

  // Branch 1: trial transitions are DB-only — trial period unchanged.
  // No Stripe call because trials have no Stripe subscription yet.
  if (org.subscription_status === "trialing") {
    const { error: updateError } = await admin
      .from("organizations")
      .update({
        plan: requestedPlan,
        team_limit: teamLimitForPlan(requestedPlan),
      })
      .eq("id", orgId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, kind: "trial_plan_changed" });
  }

  // At this point: subscription_status === 'active', isSamePlan === false,
  // stripe_subscription_id is set, and (since pending_plan is restricted to
  // club_small by the CHECK constraint) any pending schedule means
  // current=large, pending=small.
  const subscriptionId = org.stripe_subscription_id!;

  // Branch 2: active Small → Large is an immediate item-price swap. The
  // webhook (customer.subscription.updated with the new price ID) writes
  // plan and team_limit; this route makes no DB write itself.
  if (requestedPlan === "club_large") {
    const subscription = await getStripe().subscriptions.retrieve(
      subscriptionId,
    );
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      // Defensive: a Stripe subscription always has at least one item — this
      // would only fire if Stripe returned an unexpected shape.
      return NextResponse.json(
        { error: "subscription_item_missing" },
        { status: 500 },
      );
    }

    await getStripe().subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceIdForPlan("club_large") }],
      proration_behavior: "create_prorations",
    });

    return NextResponse.json({ ok: true, kind: "subscription_updated" });
  }

  // Branch 3: active Large → Small via Subscription Schedule (deferred).
  // We refuse to stack two pending downgrades — the only way to "undo" is
  // through Branch 4 (re-upgrade to Large), and a redundant request here
  // would silently spawn a second schedule.
  if (hasPendingSchedule) {
    return NextResponse.json(
      { error: "pending_plan_change" },
      { status: 400 },
    );
  }

  // 1. Migrate the subscription into a schedule so we can attach a future
  //    phase. `from_subscription` carries the existing item(s) into phase 0.
  //    metadata.org_id lets `subscription_schedule.*` webhook events match
  //    back to the org without a Stripe→DB lookup by schedule ID.
  const schedule = await getStripe().subscriptionSchedules.create({
    from_subscription: subscriptionId,
    metadata: { org_id: orgId },
  });

  const currentPhase = schedule.phases[0];
  const periodEnd = currentPhase.end_date;

  // 2. Append the Small phase starting at the current period end.
  //    Phase items must round-trip the current price+quantity verbatim;
  //    items are unexpanded by default so `item.price` is a string id.
  await getStripe().subscriptionSchedules.update(schedule.id, {
    phases: [
      {
        items: currentPhase.items.map((item) => ({
          price: priceFromPhaseItem(item),
          quantity: item.quantity,
        })),
        start_date: currentPhase.start_date,
        end_date: currentPhase.end_date,
      },
      {
        items: [{ price: priceIdForPlan("club_small"), quantity: 1 }],
        start_date: periodEnd,
      },
    ],
  });

  // 3. Stamp the pending downgrade onto the org row. plan / team_limit stay
  //    on Large until the schedule executes; the webhook flips them when
  //    customer.subscription.updated lands with the new price ID.
  const pendingPlanAt = new Date(periodEnd * 1000).toISOString();
  const { error: updateError } = await admin
    .from("organizations")
    .update({
      pending_plan: "club_small",
      pending_plan_at: pendingPlanAt,
      stripe_schedule_id: schedule.id,
    })
    .eq("id", orgId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    kind: "downgrade_scheduled",
    pendingPlanAt,
  });
}

/**
 * Phase item `price` is `string | Price | DeletedPrice` in the SDK types —
 * string when unexpanded (our case), an object when expanded. Normalise to a
 * string id so the same shape can be passed back into the update call.
 */
function priceFromPhaseItem(
  item: Stripe.SubscriptionSchedule.Phase.Item,
): string {
  return typeof item.price === "string" ? item.price : item.price.id;
}
