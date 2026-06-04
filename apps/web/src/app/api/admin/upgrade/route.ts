import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { isClubPlan, type ClubPlan } from "@/lib/plan";

/**
 * POST /api/admin/upgrade
 *
 * Internal-only route for manually upgrading an org to a club tier without
 * going through Stripe. Intended for pilot programs and testing (e.g. JOGA
 * FC) where billing is handled outside the self-serve flow. Gated by
 * ADMIN_UPGRADE_CODE.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Admin manual upgrade".
 *
 * Body: { orgId: string; plan: 'club_small' | 'club_large'; code: string }
 *
 * Fields written:
 *   plan                — from body (club_small or club_large)
 *   team_limit          — 10 for club_small, NULL for club_large
 *   subscription_status — 'active'
 *   trial_ends_at       — now(), only when currently NULL. Set-once: marks
 *                         the org trial-ineligible so it cannot later claim a
 *                         self-serve trial via /api/billing/start-trial, but
 *                         never overwrites an existing value (which is the
 *                         permanent "trial already consumed" record).
 *
 * Stripe fields (stripe_customer_id, stripe_subscription_id) are deliberately
 * left untouched — the admin upgrade does not create or modify any Stripe
 * object.
 */
export async function POST(request: Request) {
  const upgradeCode = process.env.ADMIN_UPGRADE_CODE;
  if (!upgradeCode) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, plan, code } = body as {
    orgId?: string;
    plan?: string;
    code?: string;
  };

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

  if (!code || code !== upgradeCode) {
    return NextResponse.json({ error: "invalid_code" }, { status: 403 });
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
    .maybeSingle();

  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Read current trial_ends_at to enforce set-once behaviour.
  const { data: org } = await admin
    .from("organizations")
    .select("trial_ends_at")
    .eq("id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  const update: {
    plan: ClubPlan;
    team_limit: number | null;
    subscription_status: string;
    trial_ends_at?: string;
  } = {
    plan: tierPlan,
    team_limit: tierPlan === "club_small" ? 10 : null,
    subscription_status: "active",
  };
  if (org.trial_ends_at == null) {
    // First-time admin upgrade: stamp the trial-ineligible marker. After this,
    // start-trial's `trial_ends_at IS NULL` precondition will reject a later
    // self-serve trial attempt by this org, even if it cancels back to free.
    update.trial_ends_at = new Date().toISOString();
  }

  const { error } = await admin
    .from("organizations")
    .update(update)
    .eq("id", orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
