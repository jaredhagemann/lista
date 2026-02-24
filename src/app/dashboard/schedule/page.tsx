import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ScheduleView } from "@/components/calendar/schedule-view";
import type { Database } from "@/types/database";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};
type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get current user's team membership
  const { data: rawMembership } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  if (!rawMembership) {
    redirect("/dashboard");
  }

  const membership = rawMembership as TeamMember;
  const team = membership.teams as Database["public"]["Tables"]["teams"]["Row"];
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  // Fetch all events for the team
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
