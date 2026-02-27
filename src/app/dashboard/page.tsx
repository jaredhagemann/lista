import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users } from "lucide-react";
import Link from "next/link";
import { CreateTeamForm } from "@/components/team/create-team-form";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

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
    | { id: string; name: string; season: string | null }
    | undefined;
  const isAdmin =
    membership?.role === "coach" || membership?.role === "manager";

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
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const upcomingEvents = (rawUpcomingEvents ?? []) as Event[];

  const { count: memberCount } = await supabase
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", team.id);

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
