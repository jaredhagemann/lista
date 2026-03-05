import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { Toaster } from "@/components/ui/sonner";
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
    .eq("manager_id", user.id);

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
    .select("*, teams(*)")
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

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav
        ownProfile={ownProfile}
        activeProfile={activeProfile}
        managedProfiles={managedProfiles}
        allMemberships={allMemberships}
        activeMembership={activeMembership}
        profilesOnActiveTeam={profilesOnActiveTeam}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
