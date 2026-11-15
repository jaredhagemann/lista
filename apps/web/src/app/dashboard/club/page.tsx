import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadActiveContext } from "@/lib/active-context";
import { ClubAgenda } from "@/components/club/club-agenda";
import { ClubTeamList } from "@/components/club/club-team-list";
import { agendaQueryRange, buildAgenda, type AgendaEvent } from "@/lib/club/agenda";
import { teamRecord } from "@/lib/events/team-record";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { clubSecondaryColor, compareNames, LISTA_BLUE } from "@/lib/team-branding";

export const metadata = { title: "Club Overview" };

export default async function ClubOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // This device's team (docs/specs/device-local-active-context.md), checked.
  const activeTeamId = (await loadActiveContext(supabase, user.id)).activeMembership?.team_id ?? null;

  const { data: activeTeam } = await supabase
    .from("teams")
    .select("organization_id, timezone")
    .eq("id", activeTeamId ?? "")
    .single();

  const orgId = activeTeam?.organization_id;
  if (!orgId) redirect("/dashboard");

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, timezone")
    .eq("organization_id", orgId)
    .is("archived_at", null);

  const sortedTeams = [...(teams ?? [])].sort((a, b) => compareNames(a.name, b.name));
  const teamIds = sortedTeams.map((t) => t.id);

  const now = new Date();
  const { endsAfter, startsBefore } = agendaQueryRange(now);

  const [{ data: org }, events, results, { data: managedLinks }] = await Promise.all([
    supabase.from("organizations").select("plan, brand_color_secondary").eq("id", orgId).maybeSingle(),
    teamIds.length === 0
      ? { data: [] as AgendaEvent[], error: null }
      : fetchAllRows<AgendaEvent>((from, to) =>
          // Through unknown: the typed client can't resolve `tournament_id(...)`, as
          // events has two relationships to itself.
          supabase
            .from("events")
            .select("id, team_id, title, event_type, opponent, home_away, score_for, score_against, start_time, end_time, timezone, is_cancelled, round, tournament:tournament_id(title)")
            .in("team_id", teamIds)
            .gt("end_time", endsAfter)
            .lt("start_time", startsBefore)
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: AgendaEvent[] | null; error: unknown }>,
        ),
    // The dashboard's Overall Record, for every team (team-branding-and-labels §4).
    teamIds.length === 0
      ? { data: [], error: null }
      : fetchAllRows((from, to) =>
          supabase
            .from("events")
            .select("id, team_id, start_time, timezone, opponent, home_away, game_result, score_for, score_against")
            .in("team_id", teamIds)
            .eq("event_type", "game")
            .not("game_result", "is", null)
            .order("id")
            .range(from, to),
        ),
    supabase.from("profile_managers").select("managed_id").eq("manager_id", user.id),
  ]);

  // The teams setActiveTeam will switch to: the viewer's own, and those of players they manage.
  const { data: viewerMemberships } = await supabase
    .from("team_members")
    .select("team_id")
    .in("profile_id", [user.id, ...(managedLinks ?? []).map((l) => l.managed_id)])
    .in("team_id", teamIds);
  const linkableTeamIds = new Set(
    (viewerMemberships ?? []).map((m) => m.team_id).filter((id): id is string => !!id),
  );

  const days = buildAgenda(events.data, sortedTeams, { now, homeZone: activeTeam?.timezone });

  const teamsWithRecords = sortedTeams.map((team) => ({
    ...team,
    record: teamRecord(results.data.filter((game) => game.team_id === team.id), now),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Club Overview</h1>

      {sortedTeams.length > 0 && (
        <ClubTeamList
          teams={teamsWithRecords}
          winColor={clubSecondaryColor(org) ?? LISTA_BLUE}
          failed={!!results.error}
        />
      )}

      <ClubAgenda days={days} activeTeamId={activeTeamId} linkableTeamIds={linkableTeamIds} failed={!!(teamsError || events.error)} />
    </div>
  );
}
