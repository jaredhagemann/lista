import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { hasClubAccess } from "@/lib/plan";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { TeamMutesSection } from "@/components/settings/team-mutes-section";
import { mutableTeam, type MutableTeam } from "@/lib/notifications/mutable-team";
import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import { TeamReminderSettings } from "@/components/settings/team-reminder-settings";
import { TransferOwnershipSection } from "@/components/settings/transfer-ownership-section";
import { DeleteTeamSection } from "@/components/settings/delete-team-section";
import { TrainingCategoriesSection } from "@/components/settings/training-categories-section";
import { LeaguesSection } from "@/components/leagues/leagues-section";
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
import { loadActiveContext } from "@/lib/active-context";
import type { Database } from "@/types/database";
import type { Sport } from "@/lib/training";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; team?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { tab, team: highlightTeamId } = await searchParams;
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
  // Training page — org derived from this device's team (device-local-active-context), so a
  // parent viewing a managed child gets the CHILD's team/org, not the viewer's.
  // The same context as `membership` above (one read per request).
  const context = await loadActiveContext(supabase, user.id);

  // Every team the account hears from, its own or a managed player's, once
  // each, for muting one team (team-notification-controls §3.1), with its club (§3.4).
  const mutableTeams = new Map<string, MutableTeam>();
  for (const m of context.allMemberships) {
    if (!m.teams || m.teams.archived_at) continue;
    mutableTeams.set(m.teams.id, mutableTeam(m.teams));
  }
  const { data: mutes } = await supabase
    .from("team_notification_mutes")
    .select("team_id")
    .eq("profile_id", user.id);

  let trainingProfile:
    | { id: string; firstName: string | null; optedOut: boolean }
    | null = null;
  const { data: ap } = await supabase
    .from("profiles")
    .select("id, first_name, training_leaderboard_opt_out")
    .eq("id", context.activeProfileId)
    .maybeSingle();
  if (ap && activeTeamId) {
    const { data: apTeam } = await supabase
      .from("teams")
      .select("organization_id")
      .eq("id", activeTeamId)
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

  // The team's reminder rules (team-notification-controls §4.1); no row is the defaults.
  const { data: reminderSettings } = team
    ? await supabase.from("team_reminder_settings").select("*").eq("team_id", team.id).maybeSingle()
    : { data: null };

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

  // Training categories are a club-tier feature managed by team admins. Mirror
  // the Training → Team tab's "Manage categories" affordance in the Team
  // settings tab, but only when the active team's org has club access — the same
  // gate the Training route itself enforces.
  let showTrainingCategories = false;
  if (isAdmin && team?.organization_id) {
    const { data: teamOrg } = await supabase
      .from("organizations")
      .select("plan, subscription_status")
      .eq("id", team.organization_id)
      .maybeSingle();
    showTrainingCategories =
      !!teamOrg && hasClubAccess(teamOrg.plan, teamOrg.subscription_status);
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
          <NotificationPrefsForm profileId={user.id} prefs={notifPrefs}>
            <TeamMutesSection
              profileId={user.id}
              teams={[...mutableTeams.values()]}
              mutedTeamIds={(mutes ?? []).map((m) => m.team_id)}
              highlightTeamId={highlightTeamId}
            />
          </NotificationPrefsForm>
        </TabsContent>
        {membership && team && (
          <TabsContent value="team" className="space-y-6">
            <TeamSettingsForm team={team} isAdmin={isAdmin} />
            <TeamReminderSettings teamId={team.id} settings={reminderSettings} canEdit={isAdmin} />
            {isAdmin && (
              <LeaguesSection
                teamId={team.id}
                teamName={team.name}
                defaultSeason={team.season ?? ""}
                teamTimeZone={team.timezone ?? null}
              />
            )}
            {showTrainingCategories && (
              <TrainingCategoriesSection
                teamId={team.id}
                sport={(team.sport as Sport | null) ?? null}
              />
            )}
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
