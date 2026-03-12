import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ScheduleView } from "@/components/calendar/schedule-view";
import { getActiveMembership } from "@/lib/get-active-membership";
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
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  const { data: rawEvents } = await supabase
    .from("events")
    .select("*")
    .eq("team_id", team.id)
    .order("start_time", { ascending: true });

  const events = (rawEvents ?? []) as Event[];

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
