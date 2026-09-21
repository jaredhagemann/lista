import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ScheduleView } from "@/components/calendar/schedule-view";
import { getActiveMembership } from "@/lib/get-active-membership";
import { fetchAllRows, PartialFetchError } from "@/lib/supabase/fetch-all-rows";
import { ListLoadError } from "@/components/ui/list-load-error";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/dashboard");

  const team = membership.teams as Database["public"]["Tables"]["teams"]["Row"];
  const isAdmin =
    membership.role === "coach" ||
    membership.role === "manager" ||
    membership.role === "director";

  // One query stopped at the API's 1,000-row cap, and because these are ordered
  // oldest first, the rows it dropped were the future events (BUG-014).
  let events: Event[];
  try {
    events = (await fetchAllRows((from, to) =>
      supabase
        .from("events")
        .select("*")
        .eq("team_id", team.id)
        .order("start_time", { ascending: true })
        .range(from, to)
    )) as Event[];
  } catch (error) {
    if (!(error instanceof PartialFetchError)) throw error;
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <ListLoadError
          title="Couldn't load the schedule"
          description="Some events are missing, so the calendar would be wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Schedule</h1>
      </div>
      <ScheduleView
        events={events}
        teamId={team.id}
        isAdmin={isAdmin}
        homeUniform={team.home_uniform}
        awayUniform={team.away_uniform}
      />
    </div>
  );
}
