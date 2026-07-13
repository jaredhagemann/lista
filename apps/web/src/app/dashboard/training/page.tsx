import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasClubAccess } from "@/lib/plan";
import { TrainingView } from "@/components/training/training-view";
import type { Database } from "@/types/database";

type Team = Database["public"]["Tables"]["teams"]["Row"];

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
    .select("id, name, timezone, organization_id")
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

  // Teams the ACTIVE profile can log training to: role=player, non-archived, in
  // this club-access org. Drives the log-dialog team selector.
  const { data: playerRows } = await supabase
    .from("team_members")
    .select("teams(id, name, organization_id, archived_at)")
    .eq("profile_id", activeProfile.id)
    .eq("role", "player");
  const eligibleTeams = (playerRows ?? [])
    .map((r) => r.teams as unknown as Team)
    .filter((t) => t && t.organization_id === org.id && !t.archived_at)
    .map((t) => ({ id: t.id, name: t.name }));

  // All non-archived teams in the org — the club board's team filter.
  const { data: orgTeamRows } = await supabase
    .from("teams")
    .select("id, name")
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
      }}
      org={{ id: org.id, name: org.org_name_public ?? org.name }}
      isTeamAdmin={isTeamAdmin}
      eligibleTeams={eligibleTeams}
      orgTeams={orgTeamRows ?? []}
    />
  );
}
