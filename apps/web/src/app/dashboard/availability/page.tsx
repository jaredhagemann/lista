import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
import { getActiveMembership } from "@/lib/get-active-membership";

export default async function AvailabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership || !membership.team_id) redirect("/dashboard");

  // RSVP as the profile whose membership grants access to this team (the active
  // player), not the parent-only manager who reaches it via their child.
  const activeProfileId = membership.profile_id ?? user.id;

  const teamId = membership.team_id;
  const isAdmin =
    membership.role === "coach" ||
    membership.role === "manager" ||
    membership.role === "director";

  const [{ data: eventsRaw }, { data: teamMembersRaw }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, event_type, start_time")
      .eq("team_id", teamId)
      .order("start_time"),
    supabase
      .from("team_members")
      .select("profile_id, role, profiles(first_name, last_name)")
      .eq("team_id", teamId),
  ]);

  const events = (eventsRaw ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    event_type: e.event_type as "practice" | "game" | "other",
    start_time: e.start_time,
  }));

  const members = (teamMembersRaw ?? [])
    .filter((m): m is typeof m & { profile_id: string } => m.profile_id != null)
    .map((m) => {
      const profile = m.profiles as {
        first_name: string;
        last_name: string;
      } | null;
      return {
        profileId: m.profile_id,
        role: m.role,
        name: profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ")
          : "Unknown",
      };
    });

  const eventIds = events.map((e) => e.id);
  const availabilityRows =
    eventIds.length > 0
      ? await supabase
          .from("availability")
          .select("event_id, profile_id, status")
          .in("event_id", eventIds)
          .then(({ data }) =>
            (data ?? [])
              .filter(
                (r): r is typeof r & { event_id: string; profile_id: string } =>
                  r.event_id != null && r.profile_id != null
              )
              .map((r) => ({
                event_id: r.event_id,
                profile_id: r.profile_id,
                status: r.status as "available" | "maybe" | "unavailable",
              }))
          )
      : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See who&apos;s available for upcoming events.
        </p>
      </div>

      <AvailabilityMatrix
        events={events}
        members={members}
        initialRows={availabilityRows}
        isAdmin={isAdmin}
        currentUserId={activeProfileId}
      />
    </div>
  );
}
