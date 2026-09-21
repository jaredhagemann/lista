import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

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

  const team = membership.teams as Database["public"]["Tables"]["teams"]["Row"] | null;
  const isAdmin =
    membership.role === "coach" ||
    membership.role === "manager" ||
    membership.role === "director";

  // No events, responses or roster are read here. The matrix loads one page of
  // events and the responses for exactly those events: reading a whole window up
  // front is what reached the API's row cap, and the rows it dropped rendered as
  // "no response", which is indistinguishable from a player who never replied
  // (BUG-014).

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Availability</h1>
      </div>

      <AvailabilityMatrix
        teamId={membership.team_id}
        currentUserId={activeProfileId}
        isAdmin={isAdmin}
        timeZone={team?.timezone}
      />
    </div>
  );
}
