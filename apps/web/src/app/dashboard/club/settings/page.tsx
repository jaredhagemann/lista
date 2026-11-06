import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadActiveContext } from "@/lib/active-context";
import { ClubSettingsClient } from "@/components/club/club-settings-client";
import { ClubOwnershipSection } from "@/components/club/club-ownership-section";
import { CloseClubSection } from "@/components/club/close-club-section";
import type { Database } from "@/types/database";
import type { DirectorImpact } from "@/components/club/remove-director-dialog";

export const metadata = { title: "Club Settings" };

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // This device's team (docs/specs/device-local-active-context.md), checked.
  const activeTeamId = (await loadActiveContext(supabase, user.id)).activeMembership?.team_id ?? null;

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeTeamId ?? "")
    .single();

  const orgId = team?.organization_id;
  if (!orgId) redirect("/dashboard");

  // Verify access
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations(*)")
    .eq("organization_id", orgId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/dashboard");

  const org = membership.organizations as Org;
  const orgRole = membership.role as "owner" | "director";

  // Fetch all directors for this org (owners can manage)
  const { data: directors } = await supabase
    .from("organization_members")
    .select("profile_id, role, profiles(first_name, last_name, email)")
    .eq("organization_id", orgId)
    .order("role");

  type Director = {
    profile_id: string;
    role: string;
    profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
  };

  const members = (directors ?? []) as Director[];

  // For the owner's removal dialog: what removing each director would change
  // (BUG-047). The removal itself reports what it actually did.
  const impacts = new Map<string, DirectorImpact>();
  const directorIds = members.filter((m) => m.role === "director").map((m) => m.profile_id);
  if (orgRole === "owner" && directorIds.length > 0) {
    const { data: clubTeams } = await supabase
      .from("teams")
      .select("id, name, owner_id")
      .eq("organization_id", orgId);
    const teams = clubTeams ?? [];
    const nameOfTeam = new Map(teams.map((t) => [t.id, t.name]));
    const { data: rows } = teams.length
      ? await supabase
          .from("team_members")
          .select("team_id, profile_id, role")
          .in("team_id", teams.map((t) => t.id))
          .in("profile_id", directorIds)
      : { data: [] };
    for (const id of directorIds) {
      const mine = (rows ?? []).filter((r) => r.profile_id === id);
      impacts.set(id, {
        directorTeams: mine.filter((r) => r.role === "director").length,
        ownedTeams: teams.filter((t) => t.owner_id === id).map((t) => t.name).sort(),
        otherRoles: mine
          .filter((r) => r.role !== "director")
          .map((r) => ({ team: nameOfTeam.get(r.team_id ?? "") ?? "a team", role: r.role }))
          .sort((a, b) => a.team.localeCompare(b.team)),
      });
    }
  }
  const nameOf = (d: Director) =>
    [d.profiles?.first_name, d.profiles?.last_name].filter(Boolean).join(" ") || d.profiles?.email || "Director";

  // The owner's pending offer of the club, if any (BUG-013).
  const { data: pending } =
    orgRole === "owner"
      ? await supabase
          .from("organization_ownership_transfers")
          .select("id, to_profile_id, expires_at")
          .eq("organization_id", orgId)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle()
      : { data: null };
  const pendingTo = pending && members.find((m) => m.profile_id === pending.to_profile_id);

  return (
    <div className="space-y-8">
      <ClubSettingsClient
        org={{
          id: org.id,
          name: org.name,
          orgNamePublic: org.org_name_public,
        }}
        orgRole={orgRole}
        directors={members.map((m) => ({ ...m, impact: impacts.get(m.profile_id) }))}
        currentUserId={user.id}
      />
      {orgRole === "owner" && (
        <>
          <ClubOwnershipSection
            orgId={org.id}
            directors={members
              .filter((m) => m.role === "director")
              .map((m) => ({ profileId: m.profile_id, name: nameOf(m) }))}
            pending={
              pending
                ? { id: pending.id, toName: pendingTo ? nameOf(pendingTo) : "a director", expiresAt: pending.expires_at }
                : null
            }
          />
          <CloseClubSection orgId={org.id} clubName={org.name} />
        </>
      )}
    </div>
  );
}
