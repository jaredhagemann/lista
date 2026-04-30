import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { EventDetail } from "@/components/calendar/event-detail";
import { getActiveMembership, getActiveProfileId } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"] & {
  profiles: { first_name: string; last_name: string } | null;
  locations: { name: string; address: string | null } | null;
};

type MembershipWithTeam = {
  role: string;
  teams: { home_uniform: string | null; away_uniform: string | null } | null;
};

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { eventId } = await params;
  const { edit } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Resolve active profile (may be a managed player) and the active membership.
  // getActiveMembership handles both direct team_members rows AND parent-only
  // managers whose access comes via profile_managers.
  const [activeProfileId, activeMembership] = await Promise.all([
    getActiveProfileId(user.id),
    getActiveMembership(supabase, user.id),
  ]);

  const { data: rawEvent, error } = await supabase
    .from("events")
    .select("*, profiles!events_created_by_fkey(first_name, last_name), locations(name, address)")
    .eq("id", eventId)
    .single();

  if (error || !rawEvent) {
    notFound();
  }

  const event = rawEvent as Event;

  // Verify the active membership is for the same team as this event.
  if (!activeMembership || activeMembership.team_id !== event.team_id) {
    redirect("/dashboard");
  }

  const membership = activeMembership.teams as unknown as MembershipWithTeam;
  const isAdmin =
    activeMembership.role === "coach" ||
    activeMembership.role === "manager" ||
    activeMembership.role === "director";
  const creatorProfile = event.profiles as { first_name: string; last_name: string } | null;
  const creatorName = creatorProfile
    ? [creatorProfile.first_name, creatorProfile.last_name].filter(Boolean).join(" ")
    : "Unknown";

  // Fetch availability rows and team members in parallel
  const [{ data: availabilityRows }, { data: teamMembersRaw }] = await Promise.all([
    supabase
      .from("availability")
      .select("profile_id, status")
      .eq("event_id", eventId),
    supabase
      .from("team_members")
      .select("profile_id, profiles(first_name, last_name)")
      .eq("team_id", event.team_id!),
  ]);

  const availabilityData = (availabilityRows ?? [])
    .filter((r): r is typeof r & { profile_id: string } => r.profile_id != null)
    .map((r) => ({
      profileId: r.profile_id,
      status: r.status as "available" | "maybe" | "unavailable",
    }));

  const membersData = (teamMembersRaw ?? [])
    .filter((m): m is typeof m & { profile_id: string } => m.profile_id != null)
    .map((m) => {
      const profile = m.profiles as { first_name: string; last_name: string } | null;
      return {
        profileId: m.profile_id,
        name: profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ")
          : "Unknown",
      };
    });

  return (
    <EventDetail
      event={event}
      isAdmin={isAdmin}
      creatorName={creatorName}
      initialEdit={edit === "true"}
      homeUniform={membership.teams?.home_uniform ?? null}
      awayUniform={membership.teams?.away_uniform ?? null}
      currentUserId={activeProfileId}
      availabilityRows={availabilityData}
      members={membersData}
    />
  );
}
