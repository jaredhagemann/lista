import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ScheduleView } from "@/components/calendar/schedule-view";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

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

  // No event fetch here. Opening the page used to read the team's entire
  // history before rendering either tab — past the API's row cap it dropped the
  // future events, and the List tab then paginated separately anyway (BUG-014).
  // Each tab now reads what it displays.

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Schedule</h1>
      </div>
      <ScheduleView
        teamId={team.id}
        isAdmin={isAdmin}
        timeZone={team.timezone}
        team={{
          name: team.name,
          home_uniform: team.home_uniform,
          away_uniform: team.away_uniform,
          home_uniform_color: team.home_uniform_color,
          away_uniform_color: team.away_uniform_color,
        }}
      />
    </div>
  );
}
