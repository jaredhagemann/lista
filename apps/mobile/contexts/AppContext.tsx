import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { chooseContext, onContextSaved, readStoredContext, saveContext } from "../lib/active-context";
import { useSession } from "../app/_layout";
import { rowToMembership } from "../lib/membership";
import type { OrgBranding } from "../lib/team-branding";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  avatar_url: string | null;
  active_team_id: string | null;
  birthday: string | null;
  gender: string | null;
};

export type Team = {
  id: string;
  name: string;
  /** An archived team is passed over while another exists (device-local-active-context, D4). */
  archived_at?: string | null;
  season: string | null;
  logo_url: string | null;
  home_uniform: string | null;
  away_uniform: string | null;
  /** The club, for its branding (lib/team-branding). */
  organizations?: OrgBranding | null;
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
  /** The team's own name. */
  teamName: string;
  /** "[club] - [team]" for a club team, else the team's name. */
  displayName: string;
  /** The club's name for a club team, else null. */
  clubName: string | null;
  /** The Record card's win color: the club's secondary color, else lista blue. */
  winColor: string;
  season: string | null;
  /** The team's logo, else its club's. */
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
  const [activeRow, setActiveRow] = useState<TeamMemberRow | null>(null);
  const [allMemberships, setAllMemberships] = useState<TeamMemberRow[]>([]);
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfileRow[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  // Each load is numbered; only the latest one's results are shown, so a load
  // that finishes after the account changed publishes nothing (spec §6).
  const latestLoad = useRef(0);

  /**
   * Reads the account's people and teams, and chooses this phone's context
   * (docs/specs/device-local-active-context.md): its saved tuple if still
   * valid, else the last-picked default (D2, D3). A new or repaired choice is
   * saved on this phone, unless a read failed.
   */
  const loadData = useCallback(async () => {
    const load = ++latestLoad.current;
    if (!userId) {
      setOwnProfile(null);
      setActiveProfile(null);
      setActiveRow(null);
      setAllMemberships([]);
      setManagedProfiles([]);
      return;
    }

    const stored = await readStoredContext(userId);

    const [{ data: ownData, error: ownError }, { data: managedData, error: managedError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, first_name, last_name, email, avatar_url, active_team_id, birthday, gender")
        .eq("id", userId)
        .single(),
      supabase
        .from("profile_managers")
        .select(
          "managed_id, relationship, profiles!managed_id(id, first_name, last_name, email, avatar_url, active_team_id)"
        )
        .eq("manager_id", userId)
        .neq("managed_id", userId),
    ]);
    const managed = ((managedData ?? []) as unknown as ManagedProfileRow[]).filter((m) => m.profiles);

    const { data: membershipsData, error: membershipsError } = await supabase
      .from("team_members")
      .select(
        "id, team_id, profile_id, role, teams(id, name, season, logo_url, home_uniform, away_uniform, archived_at, organizations(name, org_name_public, logo_url, plan, brand_color_secondary)), profiles(id, first_name, last_name, email, avatar_url, active_team_id)"
      )
      .in("profile_id", [userId, ...managed.map((m) => m.managed_id)])
      .order("created_at");
    if (load !== latestLoad.current) return;

    const memberships = (membershipsData ?? []) as unknown as TeamMemberRow[];
    const own = ownData as Profile | null;
    const choice = chooseContext({
      userId,
      ownProfile: own,
      managed: managed.map((m) => m.profiles),
      memberships,
      saved: stored.saved,
      legacyProfileId: stored.legacyProfileId,
    });
    const failed = stored.failed || !!(ownError || managedError || membershipsError);
    if (choice.save && !failed) await saveContext(choice.save);
    if (load !== latestLoad.current) return;

    setOwnProfile(own);
    setActiveProfile(
      choice.profileId === userId ? own : (managed.find((m) => m.managed_id === choice.profileId)?.profiles ?? own)
    );
    setActiveRow(choice.membership);
    setManagedProfiles(managed);
    setAllMemberships(memberships);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // A context saved elsewhere (the invitation screen, outside this provider)
  // takes effect here.
  useEffect(() => onContextSaved((saved) => {
    if (saved.accountId === userId) loadData();
  }), [loadData, userId]);

  // ── Derived values ───────────────────────────────────────────────────────

  const membership: ActiveMembership | null = activeRow ? rowToMembership(activeRow) : null;

  const profilesOnActiveTeam = allMemberships.filter(
    (m) => m.team_id === membership?.teamId
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Switches this phone to a person on a team (spec D1). The team is also
   * recorded as that person's "last picked", the default for devices with no
   * context of their own (D2).
   */
  async function switchTo(profileId: string, teamId: string) {
    if (!userId) return;
    setSwitching(true);
    await supabase.from("profiles").update({ active_team_id: teamId }).eq("id", profileId);
    await saveContext({ accountId: userId, profileId, teamId });
    await loadData();
    setSwitching(false);
  }

  async function switchTeam(teamId: string) {
    // Prefer own profile on the target team, fall back to first managed profile
    const forTeam = allMemberships.filter((m) => m.team_id === teamId);
    const chosen = forTeam.find((m) => m.profile_id === userId) ?? forTeam[0];
    if (!chosen) return;
    await switchTo(chosen.profile_id, teamId);
  }

  async function switchProfile(profileId: string, teamId: string) {
    if (!allMemberships.some((m) => m.profile_id === profileId && m.team_id === teamId)) return;
    await switchTo(profileId, teamId);
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
