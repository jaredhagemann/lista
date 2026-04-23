import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClubOrgProvider } from "@/context/club-org-context";
import { ClubSidebar } from "@/components/club/club-sidebar";
import type { Database } from "@/types/database";

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve active profile and its active team (mirrors dashboard layout logic)
  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  if (!activeProfile?.active_team_id) redirect("/dashboard");

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile.active_team_id)
    .single();

  if (!team?.organization_id) redirect("/dashboard");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, org_name_public, plan, subscription_status)")
    .eq("organization_id", team.organization_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/dashboard");

  const org = membership.organizations as Org;

  // Free-tier orgs don't have access to the club portal — send them to the upgrade page
  if (org.plan !== "club") redirect("/dashboard/settings?tab=plan");

  const clubOrg = {
    orgId: org.id,
    orgName: org.org_name_public ?? org.name,
    orgRole: membership.role as "owner" | "director",
    plan: org.plan,
    subscriptionStatus: org.subscription_status,
  };

  return (
    <ClubOrgProvider value={clubOrg}>
      <div className="flex gap-8">
        <ClubSidebar />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </ClubOrgProvider>
  );
}
