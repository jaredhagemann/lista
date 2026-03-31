import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AddMemberButton } from "@/components/team/add-member-button";
import { TeamRoster } from "@/components/team/team-roster";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";
import type { TeamMemberWithProfile, ContactInfo } from "@/components/team/team-roster";

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/dashboard");

  const team = membership.teams as Database["public"]["Tables"]["teams"]["Row"];
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  const [{ data: rawMembers }, { data: rawPendingInvites }] =
    await Promise.all([
      supabase
        .from("team_members")
        .select("*, profiles(*)")
        .eq("team_id", team.id)
        .order("role"),
      isAdmin
        ? supabase
            .from("invitations")
            .select("*")
            .eq("team_id", team.id)
            .is("accepted_at", null)
            .is("managed_profile_id", null)
            .order("created_at")
        : Promise.resolve({ data: [] }),
    ]);

  const members = (rawMembers ?? []) as TeamMemberWithProfile[];
  const pendingInvites = (rawPendingInvites ?? []) as InvitationRow[];

  // Fetch first profile manager for each member using service role (bypasses RLS
  // so all team members can see contact info, not just admins).
  const contactsMap: Record<string, ContactInfo> = {};
  const profileIds = members.map((m) => m.profile_id).filter(Boolean) as string[];
  if (profileIds.length > 0) {
    const admin = createAdminClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: managersData } = await admin
      .from("profile_managers")
      .select("managed_id, relationship, phone, profiles!profile_managers_manager_id_fkey(first_name, last_name, email)")
      .in("managed_id", profileIds)
      .order("created_at");
    for (const row of managersData ?? []) {
      if (!contactsMap[row.managed_id]) {
        const p = row.profiles as { first_name: string | null; last_name: string | null; email: string | null };
        contactsMap[row.managed_id] = {
          name: [p.first_name, p.last_name].filter(Boolean).join(" "),
          relationship: row.relationship,
          email: p.email,
          phone: row.phone,
        };
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {team.logo_url && (
            <img
              src={team.logo_url}
              alt={`${team.name} logo`}
              className="h-10 w-10 rounded-lg object-cover"
            />
          )}
          <h1 className="text-2xl font-bold">{team.name}</h1>
        </div>
        {isAdmin && <AddMemberButton />}
      </div>

      {team.team_photo_url && (
        <img
          src={team.team_photo_url}
          alt={`${team.name} team photo`}
          className="w-full rounded-lg object-cover"
        />
      )}

      <TeamRoster members={members} pendingInvites={pendingInvites} isAdmin={isAdmin} teamId={team.id} ownerId={team.owner_id} contactsMap={contactsMap} />
    </div>
  );
}
