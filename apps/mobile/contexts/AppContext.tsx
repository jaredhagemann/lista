import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { supabase } from "../lib/supabase";
import { useSession } from "../app/_layout";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  avatar_url: string | null;
  active_team_id: string | null;
};

export type Team = {
  id: string;
  name: string;
  season: string | null;
  logo_url: string | null;
  home_uniform: string | null;
  away_uniform: string | null;
};

export type TeamMemberRow = {
  id: string;
  team_id: string;
  profile_id: string;
  role: string;
  teams: Team;
  profiles: Profile;
};

export type ManagedProfileRow = {
  managed_id: string;
  relationship: string;
  profiles: Profile;
};

export type ActiveMembership = {
  profileId: string;
  teamId: string;
  teamName: string;
  season: string | null;
  logoUrl: string | null;
  role: string;
  homeUniform: string | null;
  awayUniform: string | null;
};

type AppContextValue = {
  ownProfile: Profile | null;
  activeProfile: Profile | null;
  membership: ActiveMembership | null;
  allMemberships: TeamMemberRow[];
  managedProfiles: ManagedProfileRow[];
  profilesOnActiveTeam: TeamMemberRow[];
  loading: boolean;
  switching: boolean;
  switchTeam: (teamId: string) => Promise<void>;
  switchProfile: (profileId: string, teamId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session?.user.id;

  const [ownProfile, setOwnProfile] = useState<Profile | null>(null);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [allMemberships, setAllMemberships] = useState<TeamMemberRow[]>([]);
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfileRow[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;

    // 1. Read active_profile_id from SecureStore
    const storedProfileId = await SecureStore.getItemAsync("active_profile_id");

    // 2. Fetch own profile
    const { data: ownData } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, avatar_url, active_team_id")
      .eq("id", userId)
      .single();

    // 3. Fetch managed profiles
    const { data: managedData } = await supabase
      .from("profile_managers")
      .select(
        "managed_id, relationship, profiles!managed_id(id, first_name, last_name, email, avatar_url, active_team_id)"
      )
      .eq("manager_id", userId)
      .neq("managed_id", userId);

    const managed = (managedData ?? []) as unknown as ManagedProfileRow[];
    const managedIds = managed.map((m) => m.managed_id);
    const allProfileIds = [userId, ...managedIds];

    // 4. Fetch all team memberships across own + managed profiles
    const { data: membershipsData } = await supabase
      .from("team_members")
      .select(
        "id, team_id, profile_id, role, teams(id, name, season, logo_url, home_uniform, away_uniform), profiles(id, first_name, last_name, email, avatar_url, active_team_id)"
      )
      .in("profile_id", allProfileIds)
      .order("created_at");

    const memberships = (membershipsData ?? []) as unknown as TeamMemberRow[];

    // 5. Validate stored profile ID
    const activeProfileId =
      storedProfileId && allProfileIds.includes(storedProfileId)
        ? storedProfileId
        : userId;

    // 6. Resolve active profile data
    let activeProf: Profile | null = (ownData as Profile | null);
    if (activeProfileId !== userId) {
      const match = managed.find((m) => m.managed_id === activeProfileId);
      if (match) activeProf = match.profiles;
    }

    setOwnProfile(ownData as Profile | null);
    setActiveProfile(activeProf);
    setManagedProfiles(managed);
    setAllMemberships(memberships);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Derived values ───────────────────────────────────────────────────────

  const membership: ActiveMembership | null = (() => {
    if (!activeProfile) return allMemberships[0] ? rowToMembership(allMemberships[0]) : null;
    const preferredTeamId = activeProfile.active_team_id;
    const m =
      allMemberships.find(
        (r) => r.profile_id === activeProfile.id && r.team_id === preferredTeamId
      ) ??
      allMemberships.find((r) => r.profile_id === activeProfile.id) ??
      allMemberships[0];
    return m ? rowToMembership(m) : null;
  })();

  const profilesOnActiveTeam = allMemberships.filter(
    (m) => m.team_id === membership?.teamId
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  async function switchTeam(teamId: string) {
    if (!userId) return;
    setSwitching(true);

    // Prefer own profile on the target team, fall back to first managed profile
    const forTeam = allMemberships.filter((m) => m.team_id === teamId);
    const chosen =
      forTeam.find((m) => m.profile_id === userId) ?? forTeam[0];
    if (!chosen) {
      setSwitching(false);
      return;
    }

    await supabase
      .from("profiles")
      .update({ active_team_id: teamId })
      .eq("id", chosen.profile_id);

    if (chosen.profile_id === userId) {
      await SecureStore.deleteItemAsync("active_profile_id");
    } else {
      await SecureStore.setItemAsync("active_profile_id", chosen.profile_id);
    }

    await loadData();
    setSwitching(false);
  }

  async function switchProfile(profileId: string, teamId: string) {
    if (!userId) return;
    setSwitching(true);

    await supabase
      .from("profiles")
      .update({ active_team_id: teamId })
      .eq("id", profileId);

    if (profileId === userId) {
      await SecureStore.deleteItemAsync("active_profile_id");
    } else {
      await SecureStore.setItemAsync("active_profile_id", profileId);
    }

    await loadData();
    setSwitching(false);
  }

  async function refresh() {
    await loadData();
  }

  return (
    <AppContext.Provider
      value={{
        ownProfile,
        activeProfile,
        membership,
        allMemberships,
        managedProfiles,
        profilesOnActiveTeam,
        loading,
        switching,
        switchTeam,
        switchProfile,
        refresh,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToMembership(m: TeamMemberRow): ActiveMembership {
  return {
    profileId: m.profile_id,
    teamId: m.team_id,
    teamName: m.teams.name,
    season: m.teams.season,
    logoUrl: m.teams.logo_url,
    role: m.role,
    homeUniform: m.teams.home_uniform,
    awayUniform: m.teams.away_uniform,
  };
}
