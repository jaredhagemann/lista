import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users } from "lucide-react";
import Link from "next/link";
import { CreateTeamForm } from "@/components/team/create-team-form";
import type { Database } from "@/types/database";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};
type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rawMemberships } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", user!.id);

  const memberships = (rawMemberships ?? []) as TeamMember[];
  const currentMembership = memberships[0] as TeamMember | undefined;
  const currentTeam = currentMembership?.teams as
    | { id: string; name: string; season: string | null }
    | undefined;
  const isAdmin =
    currentMembership?.role === "coach" ||
    currentMembership?.role === "manager";

  // If no team, show create team form
  if (!currentTeam) {
    return (
      <div className="mx-auto max-w-lg pt-8">
        <h1 className="mb-6 text-2xl font-bold">Welcome to lista</h1>
        <p className="mb-6 text-muted-foreground">
          Get started by creating your team or ask your coach for an invite link.
        </p>
        <CreateTeamForm />
      </div>
    );
  }

  // Fetch upcoming events
  const { data: rawUpcomingEvents } = await supabase
    .from("events")
    .select("*")
    .eq("team_id", currentTeam.id)
    .eq("is_cancelled", false)
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const upcomingEvents = (rawUpcomingEvents ?? []) as Event[];

  // Fetch team member count
  const { count: memberCount } = await supabase
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", currentTeam.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{currentTeam.name}</h1>
        {currentTeam.season && (
          <p className="text-muted-foreground">{currentTeam.season}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Upcoming Events */}
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
                      <span className="font-medium">{event.title}</span>
                      <Badge variant="outline" className="capitalize">
                        {event.event_type}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(event.start_time).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                    {event.location && (
                      <p className="text-sm text-muted-foreground">
                        {event.location}
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

        {/* Team Overview */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Team</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberCount ?? 0}</div>
            <p className="text-sm text-muted-foreground">team members</p>
            <Link
              href="/dashboard/team"
              className="mt-2 block text-sm text-primary hover:underline"
            >
              View roster
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
