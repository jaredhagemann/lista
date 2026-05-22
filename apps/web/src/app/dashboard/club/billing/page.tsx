import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  ClubBillingClient,
  type ClubBillingOrg,
} from "@/components/club/club-billing-client";

export const metadata = { title: "Club Billing" };

// Hoisted out of the server-component render so React-purity lint doesn't flag
// the necessarily-impure Date.now() call. Mirrors the formula in
// /api/billing/status — Math.ceil so sub-24h reads as "1 day", clamp ≥0 so a
// past trial_ends_at on a still-trialing row doesn't go negative.
function computeTrialDaysRemaining(
  trialEndsAt: string | null,
  subscriptionStatus: string | null,
): number | null {
  if (subscriptionStatus !== "trialing" || !trialEndsAt) return null;
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msRemaining / 86_400_000));
}

export default async function ClubBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile?.active_team_id ?? "")
    .single();

  const orgId = team?.organization_id;
  if (!orgId) redirect("/dashboard");

  // Owner-only — directors are redirected to the club overview. The select
  // pulls every field the spec's badge/CTA matrix needs in a single row.
  const { data: membership } = await supabase
    .from("organization_members")
    .select(
      "role, organizations(id, plan, subscription_status, team_limit, trial_ends_at, pending_plan, pending_plan_at, subscription_cancel_at, stripe_customer_id, stripe_subscription_id)",
    )
    .eq("organization_id", orgId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/dashboard");
  if (membership.role !== "owner") redirect("/dashboard/club");

  const org = membership.organizations as {
    id: string;
    plan: string | null;
    subscription_status: string | null;
    team_limit: number | null;
    trial_ends_at: string | null;
    pending_plan: string | null;
    pending_plan_at: string | null;
    subscription_cancel_at: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;
  if (!org) redirect("/dashboard");

  // Active (non-archived) team count powers the Large → Small downgrade warning.
  // Mirrors the active-only count used by the `create_club_team` RPC + the
  // over-limit banner on /dashboard/club/teams — archiving a team frees a slot
  // toward the limit, so the warning is computed off the same active subset.
  const { count: activeTeamCount } = await supabase
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("archived_at", null);

  const billingOrg: ClubBillingOrg = {
    id: org.id,
    plan: org.plan,
    subscriptionStatus: org.subscription_status,
    teamLimit: org.team_limit,
    trialEndsAt: org.trial_ends_at,
    trialDaysRemaining: computeTrialDaysRemaining(
      org.trial_ends_at,
      org.subscription_status,
    ),
    pendingPlan: org.pending_plan,
    pendingPlanAt: org.pending_plan_at,
    subscriptionCancelAt: org.subscription_cancel_at,
    hasStripeCustomer: org.stripe_customer_id != null,
    hasStripeSubscription: org.stripe_subscription_id != null,
    activeTeamCount: activeTeamCount ?? 0,
  };

  return <ClubBillingClient org={billingOrg} />;
}
