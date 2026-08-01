import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { hasClubAccess } from "@/lib/plan";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { PushSubscriptionButton } from "@/components/notifications/push-subscription";
import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import { TransferOwnershipSection } from "@/components/settings/transfer-ownership-section";
import { DeleteTeamSection } from "@/components/settings/delete-team-section";
import { AccountSettings } from "@/components/settings/account-settings";
import { PlanTabClient, type OrgPlanData } from "@/components/settings/plan-tab-client";

// Hoisted out of the server-component render so React-purity lint doesn't flag
// the necessarily-impure `Date.now()` call — this only runs during the request
// pipeline (Next.js server component) where wall-clock time is the input we
// actually need.
function computeTrialDaysRemaining(
  trialEndsAt: string | null,
  subscriptionStatus: string | null,
): number | null {
  if (subscriptionStatus !== "trialing" || !trialEndsAt) return null;
  // Math.ceil so a sub-24h trial reads as "1 day" not "0"; clamp ≥0 so a past
  // trial_ends_at on a still-trialing row doesn't go negative — matches the
  // derivation in /api/billing/status.
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msRemaining / 86_400_000));
}
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const defaultTab =
    tab === "account" || tab === "team" || tab === "plan" ? tab : "notifications";

  const [{ data: rawNotifPrefs }, membership] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("profile_id", user.id)
      .single(),
    getActiveMembership(supabase, user.id),
  ]);

  // Resolve active org for the Plan tab. The new PlanTabClient drives every
  // CTA off DB state (trial vs paid, owner vs director, trial-already-used)
  // so the full org row needed by the spec's badge / CTA matrix is fetched
  // here in one shot.
  const activeTeamId = (membership?.teams as { id?: string } | undefined)?.id;
  let orgPlan: OrgPlanData | null = null;
  if (activeTeamId) {
    const { data: teamOrg } = await supabase
      .from("teams")
      .select("organization_id")
      .eq("id", activeTeamId)
      .single();
    if (teamOrg?.organization_id) {
      const { data: orgMembership } = await supabase
        .from("organization_members")
        .select(
          "role, organizations(id, plan, subscription_status, team_limit, trial_ends_at, pending_plan, subscription_cancel_at, stripe_subscription_id)",
        )
        .eq("organization_id", teamOrg.organization_id)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (orgMembership) {
        const org = orgMembership.organizations as {
          id: string;
          plan: string | null;
          subscription_status: string | null;
          team_limit: number | null;
          trial_ends_at: string | null;
          pending_plan: string | null;
          subscription_cancel_at: string | null;
          stripe_subscription_id: string | null;
        } | null;
        if (org) {
          orgPlan = {
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
            subscriptionCancelAt: org.subscription_cancel_at,
            hasStripeSubscription: org.stripe_subscription_id != null,
            orgRole: orgMembership.role,
          };
        }
      }
    }
  }

  // Resolve the active profile (own or a managed child) for the training
  // leaderboard opt-out toggle — shown only when the ACTIVE PROFILE's team's org
  // has club access (training is a club-tier feature). Resolved independently of
  // the Plan tab's `orgPlan`: that is scoped to organization_members
  // (owners/directors), so reusing it would hide the toggle from ordinary
  // players, who are the people the toggle is actually for. This mirrors the
  // Training page — org derived from the active profile's active_team_id, so a
  // parent viewing a managed child gets the CHILD's team/org, not the viewer's.
  const cookieStore = await cookies();
  const activeProfileId = cookieStore.get("active_profile_id")?.value ?? user.id;
  let trainingProfile:
    | { id: string; firstName: string | null; optedOut: boolean }
    | null = null;
  const { data: ap } = await supabase
    .from("profiles")
    .select("id, first_name, training_leaderboard_opt_out, active_team_id")
    .eq("id", activeProfileId)
    .maybeSingle();
  if (ap?.active_team_id) {
    const { data: apTeam } = await supabase
      .from("teams")
      .select("organization_id")
      .eq("id", ap.active_team_id)
      .maybeSingle();
    if (apTeam?.organization_id) {
      const { data: apOrg } = await supabase
        .from("organizations")
        .select("plan, subscription_status")
        .eq("id", apTeam.organization_id)
        .maybeSingle();
      if (apOrg && hasClubAccess(apOrg.plan, apOrg.subscription_status)) {
        trainingProfile = {
          id: ap.id,
          firstName: ap.first_name,
          optedOut: ap.training_leaderboard_opt_out,
        };
      }
    }
  }

  const notifPrefs = rawNotifPrefs as NotifPrefs | null;
  const isAdmin =
    membership?.role === "coach" ||
    membership?.role === "manager" ||
    membership?.role === "director";
  const team = membership?.teams as Database["public"]["Tables"]["teams"]["Row"] | undefined;
  const isOwner = !!team && team.owner_id === user.id;

  // Fetch eligible admins for ownership transfer (auth-backed coaches/managers only)
  let eligibleAdmins: { profileId: string; name: string; role: string }[] = [];
  if (isOwner && team) {
    const admin = createAdminClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: adminMembers } = await admin
      .from("team_members")
      .select("profile_id, role, profiles(first_name, last_name, auth_user_id)")
      .eq("team_id", team.id)
      .in("role", ["coach", "manager", "director"])
      .neq("profile_id", user.id);

    eligibleAdmins = (adminMembers ?? [])
      .filter((m) => {
        const p = m.profiles as { auth_user_id: string | null } | null;
        return p?.auth_user_id != null;
      })
      .map((m) => {
        const p = m.profiles as { first_name: string | null; last_name: string | null } | null;
        return {
          profileId: m.profile_id!,
          name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown",
          role: m.role,
        };
      });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {membership && <TabsTrigger value="team">Team</TabsTrigger>}
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
        </TabsList>
        <TabsContent value="notifications" className="space-y-8">
          <NotificationPrefsForm profileId={user.id} prefs={notifPrefs} />
          <PushSubscriptionButton />
        </TabsContent>
        {membership && team && (
          <TabsContent value="team" className="space-y-6">
            <TeamSettingsForm team={team} isAdmin={isAdmin} />
            {isOwner && (
              <>
                <TransferOwnershipSection
                  teamId={team.id}
                  eligibleAdmins={eligibleAdmins}
                />
                <DeleteTeamSection teamId={team.id} teamName={team.name} />
              </>
            )}
          </TabsContent>
        )}
        <TabsContent value="account" className="space-y-6">
          <AccountSettings trainingProfile={trainingProfile} />
        </TabsContent>
        <TabsContent value="plan" className="space-y-6">
          <PlanTabClient orgPlan={orgPlan} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
