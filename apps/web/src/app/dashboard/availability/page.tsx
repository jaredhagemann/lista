import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
import { AvailabilityWindowTabs } from "@/components/availability/window-tabs";
import { getActiveMembership } from "@/lib/get-active-membership";
import { fetchAllRows, PartialFetchError } from "@/lib/supabase/fetch-all-rows";
import { ListLoadError } from "@/components/ui/list-load-error";
import { parseWindow, windowRange, windowDescription } from "@/lib/availability-window";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
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

  // The matrix used to load every event the team ever held, and every response to
  // all of them — responses multiply events by players, so this is the query that
  // reached the API's 1,000-row cap first, and the rows it dropped rendered as
  // "no response" (BUG-014). It now covers a window, and reads it completely.
  const activeWindow = parseWindow((await searchParams).window);
  const range = windowRange(activeWindow);

  let eventsRaw: { id: string; title: string; event_type: string; start_time: string }[];
  let teamMembersRaw: { profile_id: string | null; role: string; profiles: unknown }[];
  let availabilityRows: { event_id: string; profile_id: string; status: "available" | "maybe" | "unavailable" }[];

  try {
    [eventsRaw, teamMembersRaw] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("events")
          .select("id, title, event_type, start_time")
          .eq("team_id", teamId)
          .gte("start_time", range.from)
          .lte("start_time", range.to)
          .order("start_time")
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("team_members")
          .select("profile_id, role, profiles(first_name, last_name)")
          .eq("team_id", teamId)
          .order("profile_id")
          .range(from, to)
      ),
    ]);

    const windowEventIds = eventsRaw.map((e) => e.id);
    availabilityRows =
      windowEventIds.length > 0
        ? (
            await fetchAllRows((from, to) =>
              supabase
                .from("availability")
                .select("event_id, profile_id, status")
                .in("event_id", windowEventIds)
                .order("event_id")
                .range(from, to)
            )
          )
            .filter(
              (r): r is typeof r & { event_id: string; profile_id: string } =>
                r.event_id != null && r.profile_id != null
            )
            .map((r) => ({
              event_id: r.event_id,
              profile_id: r.profile_id,
              status: r.status as "available" | "maybe" | "unavailable",
            }))
        : [];
  } catch (error) {
    if (!(error instanceof PartialFetchError)) throw error;
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-2xl font-bold">Availability</h1>
        <ListLoadError
          title="Couldn't load availability"
          description="Some responses are missing, and a missing response looks the same as 'no reply' — so showing this would be misleading."
        />
      </div>
    );
  }

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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Availability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {windowDescription(activeWindow)}
          </p>
        </div>
        <AvailabilityWindowTabs active={activeWindow} />
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
