import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { isClubPlan, type ClubPlan } from "@/lib/plan";

/**
 * POST /api/billing/start-trial
 *
 * Starts a 90-day Club trial for the caller's org. No Stripe interaction —
 * the trial is purely a DB state and is converted (or downgraded) by the
 * trial-expiration cron at day 91.
 *
 * `trial_ends_at` is the permanent "trial already consumed" gate: once set, it
 * is never cleared. A free org whose `trial_ends_at IS NOT NULL` (either from
 * a previous trial OR the legacy-club backfill in migration
 * 20260519000000_club_tier_monetization.sql) must subscribe via
 * create-checkout instead.
 *
 * Body: { orgId: string; plan: 'club_small' | 'club_large' }
 *
 * Response: { ok: true, trialEndsAt: ISO-8601 string }
 */

const TRIAL_DAYS = 90;

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
      { status: 400 }
    );
  }

  const tierPlan: ClubPlan = plan;

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
    .select("plan, trial_ends_at, stripe_subscription_id")
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Preconditions per spec "Route Authorization & State Requirements":
  //   plan = 'free', trial_ends_at IS NULL, stripe_subscription_id IS NULL.
  // Each precondition gets a distinct error so the UI can route the user to the
  // right next step (checkout vs. portal vs. "you already have a trial").
  if (org.plan !== "free") {
    return NextResponse.json(
      { error: "not_free_plan" },
      { status: 400 }
    );
  }

  if (org.trial_ends_at != null) {
    // Trial already consumed — either an actual previous trial or the legacy
    // backfill that marks pre-existing club orgs as ineligible. Direct the
    // user to checkout (start-trial cannot grant a second trial).
    return NextResponse.json(
      { error: "trial_already_used" },
      { status: 400 }
    );
  }

  if (org.stripe_subscription_id != null) {
    return NextResponse.json(
      { error: "subscription_exists" },
      { status: 400 }
    );
  }

  const trialEndsAt = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const teamLimit = tierPlan === "club_small" ? 10 : null;

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      plan: tierPlan,
      subscription_status: "trialing",
      team_limit: teamLimit,
      trial_ends_at: trialEndsAt,
    })
    .eq("id", orgId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, trialEndsAt });
}
