import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ClubSettingsClient } from "@/components/club/club-settings-client";
import type { Database } from "@/types/database";

export const metadata = { title: "Club Settings" };

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile?.active_team_id ?? "")
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

  return (
    <ClubSettingsClient
      org={{
        id: org.id,
        name: org.name,
        orgNamePublic: org.org_name_public,
      }}
      orgRole={orgRole}
      directors={(directors ?? []) as Director[]}
      currentUserId={user.id}
    />
  );
}
