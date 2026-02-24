import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { EventDetail } from "@/components/calendar/event-detail";
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

  const { data: rawEvent, error } = await supabase
    .from("events")
    .select("*, profiles!events_created_by_fkey(first_name, last_name), locations(name, address)")
    .eq("id", eventId)
    .single();

  if (error || !rawEvent) {
    notFound();
  }

  const event = rawEvent as Event;

  // Check if user is a member of this team and get team uniforms
  const { data: rawMembership } = await supabase
    .from("team_members")
    .select("role, teams(home_uniform, away_uniform)")
    .eq("team_id", event.team_id!)
    .eq("profile_id", user.id)
    .single();

  if (!rawMembership) {
    redirect("/dashboard");
  }

  const membership = rawMembership as MembershipWithTeam;
  const isAdmin = membership.role === "coach" || membership.role === "manager";
  const creatorProfile = event.profiles as { first_name: string; last_name: string } | null;
  const creatorName = creatorProfile
    ? [creatorProfile.first_name, creatorProfile.last_name].filter(Boolean).join(" ")
    : "Unknown";

  return (
    <EventDetail
      event={event}
      isAdmin={isAdmin}
      creatorName={creatorName}
      initialEdit={edit === "true"}
      homeUniform={membership.teams?.home_uniform ?? null}
      awayUniform={membership.teams?.away_uniform ?? null}
    />
  );
}
