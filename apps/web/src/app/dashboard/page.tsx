import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import Link from "next/link";
import { CreateTeamForm } from "@/components/team/create-team-form";
import { getActiveMembership } from "@/lib/get-active-membership";
import { LocalTime } from "@/components/ui/local-time";
import { UniformLabel } from "@/components/events/uniform-label";
import { gameTitle, uniformOf, type TeamUniforms } from "@/lib/events/game-display";
import { isUsableTimeZone } from "@/lib/events/event-timezone";
import { formatEventTime, formatShortEventDate } from "@/lib/notifications/event-time";
import type { Database } from "@/types/database";
import { displayLabel } from "@/lib/labels";
import { TeamCard } from "@/components/team/team-card";
import { RecordCard } from "@/components/team/record-card";
import { clubSecondaryColor, LISTA_BLUE } from "@/lib/team-branding";
import { teamRecord } from "@/lib/events/team-record";
import { isTournament, isUnderway, placementText, tournamentDates, tournamentRecord } from "@/lib/events/tournament";

type Event = Database["public"]["Tables"]["events"]["Row"] & {
  locations: { name: string } | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getActiveMembership(supabase, user!.id);
  const team = membership?.teams as
    | ({
        id: string;
        name: string;
        season: string | null;
        timezone: string | null;
        logo_url: string | null;
        organization_id: string | null;
      } & TeamUniforms)
    | undefined;
  const isAdmin =
    membership?.role === "coach" ||
    membership?.role === "manager" ||
    membership?.role === "director";

  if (!team) {
    return (
      <div className="mx-auto max-w-lg pt-8">
        <h1 className="mb-6 text-2xl font-bold">Welcome to lista</h1>
        <p className="mb-6 text-muted-foreground">
          Get started by creating your team or ask your coach for an invite
          link.
        </p>
        <CreateTeamForm />
      </div>
    );
  }

  const { data: rawUpcomingEvents } = await supabase
    .from("events")
    .select("*, locations(name)")
    .eq("team_id", team.id)
    .eq("is_cancelled", false)
    // By end time: a tournament stays listed while it's underway
    // (docs/specs/tournaments-and-leagues.md §4).
    .gt("end_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const upcomingEvents = (rawUpcomingEvents ?? []) as Event[];

  // The Team card: the club's branding, and the team's games with a result
  // (spec: team-branding-and-labels §4).
  const [{ data: members }, { data: org }, { data: resultGames }, { data: placedTournaments }] = await Promise.all([
    supabase.from("team_members").select("id, role, profiles(first_name, last_name)").eq("team_id", team.id),
    team.organization_id
      ? supabase
          .from("organizations")
          .select("name, org_name_public, logo_url, plan, brand_color_secondary")
          .eq("id", team.organization_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("events")
      .select("start_time, timezone, opponent, home_away, game_result, score_for, score_against, tournament_id")
      .eq("team_id", team.id)
      .eq("event_type", "game")
      .not("game_result", "is", null),
    // The latest finished tournament with a placement, for the Record card (D8).
    supabase
      .from("events")
      .select("id, title, start_time, end_time, timezone, placement_rank, placement_label")
      .eq("team_id", team.id)
      .eq("event_type", "tournament")
      .eq("is_cancelled", false)
      .lte("end_time", new Date().toISOString())
      .or("placement_rank.not.is.null,placement_label.not.is.null")
      .order("end_time", { ascending: false })
      .limit(1),
  ]);

  const record = teamRecord(resultGames ?? []);
  // D8: the tournament is the last result until a game starts after it ended.
  // With no game results at all, a placement is still a result (review TL-022).
  const placed = placedTournaments?.[0];
  const lastTournament =
    placed && (!record || Date.parse(placed.end_time) > Date.parse(record.last.startTime))
      ? {
          title: placed.title,
          placement: placementText(placed) ?? "",
          record: tournamentRecord(placed.id, resultGames ?? []),
          dates: tournamentDates(placed, team.timezone),
        }
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{team.name}</h1>
        {team.season && (
          <p className="text-muted-foreground">{team.season}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Upcoming Events
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {upcomingEvents.length > 0 ? (
              <div className="space-y-3">
                {upcomingEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/dashboard/schedule/${event.id}`}
                    className="block rounded-md p-2 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{gameTitle(event, team.name)}</span>
                      <span className="flex items-center gap-1.5">
                        {isTournament(event) && isUnderway(event) && <Badge variant="secondary">Now</Badge>}
                        <Badge variant="outline">{displayLabel(event.event_type)}</Badge>
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        // A tournament spans whole days: its dates, not a time.
                        if (isTournament(event)) return tournamentDates(event, team.timezone);
                        // The event's own zone, else the team's, labeled (BUG-010). With
                        // neither, only the viewer's browser knows a sensible zone.
                        const zone = [event.timezone, team.timezone].find(isUsableTimeZone);
                        return zone ? (
                          `${formatShortEventDate(event.start_time, zone)}, ${formatEventTime(event.start_time, zone)}`
                        ) : (
                          <LocalTime
                            isoString={event.start_time}
                            options={{
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }}
                          />
                        );
                      })()}
                    </p>
                    {event.event_type === "game" && uniformOf(event.uniform, team) && (
                      <div className="mt-1">
                        <UniformLabel uniform={uniformOf(event.uniform, team)} />
                      </div>
                    )}
                    {event.locations?.name && (
                      <p className="text-sm text-muted-foreground">
                        {event.locations.name}
                      </p>
                    )}
                  </Link>
                ))}
                <Link
                  href="/dashboard/schedule"
                  className="block text-center text-sm text-primary hover:underline"
                >
                  View full schedule
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No upcoming events.{" "}
                {isAdmin && (
                  <Link
                    href="/dashboard/schedule"
                    className="text-primary hover:underline"
                  >
                    Create one
                  </Link>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <TeamCard team={{ ...team, organizations: org }} members={members ?? []} />

        {(record || lastTournament) && (
          <RecordCard
            teamName={team.name}
            record={record}
            teamTimeZone={team.timezone}
            winColor={clubSecondaryColor(org) ?? LISTA_BLUE}
            lastTournament={lastTournament}
          />
        )}
      </div>
    </div>
  );
}
