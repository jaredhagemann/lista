import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { Toaster } from "@/components/ui/sonner";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

export type ManagedProfileEntry = {
  profile: Profile;
  relationship: string | null;
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = getTenantFromHeaders(await headers());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Resolve active profile from cookie (own profile is the default)
  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  // Fetch own profile
  const { data: rawOwnProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const ownProfile = rawOwnProfile as Profile | null;

  // Fetch managed profiles
  const { data: rawManagedLinks } = await supabase
    .from("profile_managers")
    .select("managed_id, relationship, profiles!managed_id(*)")
    .eq("manager_id", user.id)
    .neq("managed_id", user.id);

  const managedProfiles: ManagedProfileEntry[] = (rawManagedLinks ?? []).map(
    (link) => ({
      profile: link.profiles as unknown as Profile,
      relationship: link.relationship,
    })
  );

  // Validate cookie: if the stored profile isn't owned by this user, reset to own
  const isValidActiveProfile =
    activeProfileId === user.id ||
    managedProfiles.some((m) => m.profile.id === activeProfileId);

  const resolvedActiveProfileId = isValidActiveProfile
    ? activeProfileId
    : user.id;

  // Fetch active profile (may differ from own)
  const activeProfile =
    resolvedActiveProfileId === user.id
      ? ownProfile
      : (managedProfiles.find(
          (m) => m.profile.id === resolvedActiveProfileId
        )?.profile ?? ownProfile);

  // Fetch all team memberships across own + managed profiles
  const allProfileIds = [
    user.id,
    ...managedProfiles.map((m) => m.profile.id),
  ];

  const { data: rawAllMemberships } = await supabase
    .from("team_members")
    .select("*, teams(*), profiles(*)")
    .in("profile_id", allProfileIds)
    .order("created_at");

  const allMemberships = (rawAllMemberships ?? []) as TeamMember[];

  // Determine active membership from the active profile's active_team_id
  const activeMembership =
    allMemberships.find(
      (m) =>
        m.profile_id === resolvedActiveProfileId &&
        m.team_id === activeProfile?.active_team_id
    ) ??
    allMemberships.find((m) => m.profile_id === resolvedActiveProfileId) ??
    allMemberships[0] ??
    null;

  // Find all profiles (own + managed) that are on the active team
  // — used to show the "Viewing As" switcher
  const activeTeamId = activeMembership?.team_id;
  const profilesOnActiveTeam = activeTeamId
    ? allMemberships.filter((m) => m.team_id === activeTeamId)
    : [];

  // Check if the active user is an org owner/director for the active team's org
  const activeOrgId = (activeMembership?.teams as { organization_id?: string | null } | null)?.organization_id ?? null;
  let orgRole: "owner" | "director" | null = null;
  let activeOrgSubdomain: string | null = null;
  if (activeOrgId) {
    const [{ data: orgMembership }, { data: orgData }] = await Promise.all([
      supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", activeOrgId)
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("subdomain, subdomain_status, plan")
        .eq("id", activeOrgId)
        .maybeSingle(),
    ]);
    orgRole = (orgMembership?.role as "owner" | "director" | null) ?? null;
    if (orgData?.plan === "club" && orgData?.subdomain_status === "active" && orgData?.subdomain) {
      activeOrgSubdomain = orgData.subdomain;
    }
  }

  // Enforce that club-team users always land on their org's subdomain and
  // free-team users always land on the main domain.
  // Disabled when SUBDOMAIN_ROUTING_ENABLED=false (e.g. staging on vercel.app URLs).
  if (process.env.SUBDOMAIN_ROUTING_ENABLED !== "false") {
    const currentSubdomain = tenant?.subdomain ?? null;
    if (activeOrgSubdomain && currentSubdomain !== activeOrgSubdomain) {
      redirect(`https://${activeOrgSubdomain}.lista.team/dashboard`);
    }
    if (!activeOrgSubdomain && currentSubdomain) {
      redirect(`https://lista.team/dashboard`);
    }
  }

  // Compute total unread chat count for the nav badge
  // Count messages newer than last_read_at in channels/DMs the user participates in
  let chatUnreadCount = 0;
  if (activeTeamId) {
    // Team channel unread: messages after channel_members.last_read_at (or all if no row)
    const { data: teamChannel } = await supabase
      .from("channels")
      .select("id")
      .eq("team_id", activeTeamId)
      .eq("type", "team")
      .maybeSingle();

    if (teamChannel) {
      const { data: readRow } = await supabase
        .from("channel_members")
        .select("last_read_at")
        .eq("channel_id", teamChannel.id)
        .eq("profile_id", user.id)
        .maybeSingle();

      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", teamChannel.id)
        .is("deleted_at", null)
        .neq("sender_id", user.id)
        .gt("created_at", readRow?.last_read_at ?? "1970-01-01");

      chatUnreadCount += count ?? 0;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav
        ownProfile={ownProfile}
        activeProfile={activeProfile}
        allMemberships={allMemberships}
        activeMembership={activeMembership}
        profilesOnActiveTeam={profilesOnActiveTeam}
        chatUnreadCount={chatUnreadCount}
        logoUrl={tenant?.logoUrl ?? null}
        orgName={tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? undefined) : undefined}
        orgRole={orgRole}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
