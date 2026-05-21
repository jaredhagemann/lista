import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ClubTeamsClient } from "@/components/club/club-teams-client";
import type { OrgPlan } from "@/lib/plan";

export const metadata = { title: "Club Teams" };

export default async function ClubTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
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

  // Plan + team_limit feed the over-limit banner (spec: "Over-Limit Downgrade").
  // Banner copy is keyed off the plan tier — Free vs Club Small — so we need
  // both fields, not just the cap.
  const { data: org } = await supabase
    .from("organizations")
    .select("plan, team_limit")
    .eq("id", orgId)
    .single();

  const { archived } = await searchParams;
  const showArchived = archived === "1";

  // Fetch teams with member counts
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, season, created_at, archived_at, owner_id")
    .eq("organization_id", orgId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");

  const activeTeams = (teams ?? []).filter((t) => !t.archived_at);
  const archivedTeams = (teams ?? []).filter((t) => t.archived_at);

  // Get member counts for all teams in one query
  const allTeamIds = (teams ?? []).map((t) => t.id);
  const { data: memberRows } = await supabase
    .from("team_members")
    .select("team_id")
    .in("team_id", allTeamIds.length ? allTeamIds : [""]);

  const memberCountByTeam: Record<string, number> = {};
  for (const row of memberRows ?? []) {
    if (row.team_id) {
      memberCountByTeam[row.team_id] = (memberCountByTeam[row.team_id] ?? 0) + 1;
    }
  }

  const enriched = (teams ?? []).map((t) => ({
    ...t,
    memberCount: memberCountByTeam[t.id] ?? 0,
  }));

  return (
    <ClubTeamsClient
      orgId={orgId}
      teams={enriched}
      activeTeams={activeTeams.map((t) => ({
        ...t,
        memberCount: memberCountByTeam[t.id] ?? 0,
      }))}
      archivedTeams={archivedTeams.map((t) => ({
        ...t,
        memberCount: memberCountByTeam[t.id] ?? 0,
      }))}
      showArchived={showArchived}
      plan={(org?.plan as OrgPlan | null) ?? null}
      teamLimit={org?.team_limit ?? null}
      activeTeamCount={activeTeams.length}
    />
  );
}
