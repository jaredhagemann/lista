import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasClubAccess } from "@/lib/plan";
import { TrainingView } from "@/components/training/training-view";
import type { Sport } from "@/lib/training";

export const metadata = { title: "Training" };

export default async function TrainingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve the active profile + its active team (same preamble as club/layout).
  const cookieStore = await cookies();
  const activeProfileId = cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, training_leaderboard_opt_out, active_team_id")
    .eq("id", activeProfileId)
    .single();

  if (!activeProfile?.active_team_id) redirect("/dashboard");

  const { data: activeTeam } = await supabase
    .from("teams")
    .select("id, name, timezone, organization_id, sport")
    .eq("id", activeProfile.active_team_id)
    .single();

  if (!activeTeam?.organization_id) redirect("/dashboard");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, org_name_public, plan, subscription_status")
    .eq("id", activeTeam.organization_id)
    .single();

  // Club-tier route guard — mirrors the DB policy / RPC gate.
  if (!org || !hasClubAccess(org.plan, org.subscription_status)) {
    redirect("/dashboard/settings?tab=plan");
  }

  // Is the *viewer* an admin of the active team (coach/manager/director), or an
  // org admin? Drives whether the coach-facing "Team" tab is shown.
  const [{ data: viewerMembership }, { data: orgMembership }] = await Promise.all([
    supabase
      .from("team_members")
      .select("role")
      .eq("team_id", activeTeam.id)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", org.id)
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);
  const isTeamAdmin =
    ["coach", "manager", "director"].includes(viewerMembership?.role ?? "") ||
    ["owner", "director"].includes(orgMembership?.role ?? "");

  // Teams the ACTIVE profile can log training to. Eligibility is per-TEAM, not
  // per active org: any team the profile is a current player on whose OWN org
  // has club access — including teams in a DIFFERENT club org, since sessions
  // are global to the player and cross-org membership is supported. So the
  // player never has to switch active teams to log through another eligible one.
  const { data: playerRows } = await supabase
    .from("team_members")
    .select("teams(id, name, archived_at, timezone, organizations(plan, subscription_status))")
    .eq("profile_id", activeProfile.id)
    .eq("role", "player");
  type EligibleRow = {
    id: string;
    name: string;
    archived_at: string | null;
    timezone: string | null;
    organizations: { plan: string | null; subscription_status: string | null } | null;
  };
  const eligibleTeams = (playerRows ?? [])
    .map((r) => r.teams as unknown as EligibleRow)
    .filter(
      (t) =>
        t &&
        !t.archived_at &&
        t.organizations &&
        hasClubAccess(t.organizations.plan, t.organizations.subscription_status),
    )
    .map((t) => ({ id: t.id, name: t.name, timezone: t.timezone }));

  // All non-archived teams in the org — the club board's team filter.
  const { data: orgTeamRows } = await supabase
    .from("teams")
    .select("id, name, timezone")
    .eq("organization_id", org.id)
    .is("archived_at", null)
    .order("name");

  return (
    <TrainingView
      viewerId={user.id}
      activeProfile={{
        id: activeProfile.id,
        firstName: activeProfile.first_name,
        lastName: activeProfile.last_name,
        optedOut: activeProfile.training_leaderboard_opt_out,
      }}
      activeTeam={{
        id: activeTeam.id,
        name: activeTeam.name,
        timezone: activeTeam.timezone,
        sport: (activeTeam.sport as Sport | null) ?? null,
      }}
      org={{ id: org.id, name: org.org_name_public ?? org.name }}
      isTeamAdmin={isTeamAdmin}
      eligibleTeams={eligibleTeams}
      orgTeams={orgTeamRows ?? []}
    />
  );
}
