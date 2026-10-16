/**
 * Which person a device views as, and which team
 * (docs/specs/device-local-active-context.md).
 *
 * Each device keeps its own context, saved as one tuple (D1). The shared
 * profiles.active_team_id is only the "last picked" default, read when a device
 * has no valid context of its own (D2), or when its saved team is no longer one
 * the account can use (D3, D4). Nothing saved is trusted: the profile must be
 * the account's own or one it manages, and the team one that profile is on (D6).
 */

import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { OrgBranding } from "@/lib/team-branding";
import {
  ACTIVE_CONTEXT_COOKIE,
  LEGACY_PROFILE_COOKIE,
  decodeContext,
  type SavedContext,
} from "@/lib/active-context-cookie";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** The least the choice needs from a membership. */
export type ContextMembership = {
  profile_id: string | null;
  team_id: string | null;
  /** Null when the team can't be seen. */
  teams: { id: string; archived_at: string | null } | null;
};

export type ContextChoice<M extends ContextMembership> = {
  profileId: string;
  membership: M | null;
  /** The tuple to save on this device, when what it had is missing or no longer valid; else null. */
  save: SavedContext | null;
};

/**
 * Chooses the device's context. Pure: the reads happen in loadActiveContext.
 *
 *   1. A saved tuple for this account, a profile it may act as and one of that
 *      profile's teams: kept as it is.
 *   2. Otherwise a person, in order: the saved one, the old profile cookie's, the
 *      account's own. Each must be the account's own or managed. The first with
 *      a team wins, at their last-picked team (D2), else their first.
 *   3. Otherwise any team of the account's people: a parent with no team of
 *      their own views as a child. The person follows the team.
 *
 * Archived teams are passed over while another exists (D4).
 */
export function chooseContext<M extends ContextMembership>(input: {
  userId: string;
  ownProfile: { id: string; active_team_id: string | null } | null;
  managed: { id: string; active_team_id: string | null }[];
  /** The memberships of the account's own and managed profiles, earliest first. */
  memberships: M[];
  saved: SavedContext | null;
  legacyProfileId: string | null;
}): ContextChoice<M> {
  const { userId, ownProfile, managed, memberships, saved, legacyProfileId } = input;
  const allowed = new Set([userId, ...managed.map((m) => m.id)]);
  const visible = memberships.filter((m) => m.teams && m.profile_id && allowed.has(m.profile_id));
  const current = visible.filter((m) => !m.teams!.archived_at);
  const pool = current.length > 0 ? current : visible;
  const find = (profileId: string, teamId?: string | null) =>
    pool.find((m) => m.profile_id === profileId && (teamId === undefined || m.team_id === teamId)) ?? null;
  const chosen = (membership: M): ContextChoice<M> => {
    const tuple = { accountId: userId, profileId: membership.profile_id!, teamId: membership.team_id! };
    const same =
      saved?.accountId === tuple.accountId && saved.profileId === tuple.profileId && saved.teamId === tuple.teamId;
    return { profileId: tuple.profileId, membership, save: same ? null : tuple };
  };

  const savedForMe = saved && saved.accountId === userId && allowed.has(saved.profileId) ? saved : null;
  if (savedForMe) {
    const kept = find(savedForMe.profileId, savedForMe.teamId);
    if (kept) return chosen(kept);
  }

  const lastPicked = (profileId: string) =>
    profileId === userId ? ownProfile?.active_team_id : managed.find((m) => m.id === profileId)?.active_team_id;
  const people = [savedForMe?.profileId, legacyProfileId, userId].filter(
    (id, i, all): id is string => !!id && allowed.has(id) && all.indexOf(id) === i
  );
  for (const profileId of people) {
    const membership = (lastPicked(profileId) && find(profileId, lastPicked(profileId))) || find(profileId);
    if (membership) return chosen(membership);
  }

  if (pool[0]) return chosen(pool[0]);
  return { profileId: people[0] ?? userId, membership: null, save: null };
}

// ── Reading it ───────────────────────────────────────────────────────────────

export type ActiveContextMembership = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"] & { organizations: OrgBranding | null };
  profiles: Profile | null;
};

export type ManagedProfileEntry = { profile: Profile; relationship: string | null };

export type ActiveContext = {
  ownProfile: Profile | null;
  managedProfiles: ManagedProfileEntry[];
  /** Every membership of the account's own and managed profiles, for the switchers. */
  allMemberships: ActiveContextMembership[];
  activeProfileId: string;
  activeProfile: Profile | null;
  activeMembership: ActiveContextMembership | null;
  /** To save on this device (D2, D3); null when nothing needs saving, or a read failed. */
  save: SavedContext | null;
};

/**
 * The device's context, read once per request per client. A read that fails
 * saves nothing, so it can't overwrite a good saved context (D3).
 */
export const loadActiveContext = cache(async function loadActiveContext(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveContext> {
  const cookieStore = await cookies();
  const saved = decodeContext(cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value);
  const legacyProfileId = cookieStore.get(LEGACY_PROFILE_COOKIE)?.value || null;

  const [{ data: ownProfile, error: ownError }, { data: links, error: linksError }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("profile_managers")
      .select("managed_id, relationship, profiles!managed_id(*)")
      .eq("manager_id", userId)
      .neq("managed_id", userId),
  ]);
  const managedProfiles: ManagedProfileEntry[] = (links ?? [])
    .filter((link) => link.profiles)
    .map((link) => ({ profile: link.profiles as unknown as Profile, relationship: link.relationship }));

  const { data: rows, error: membershipsError } = await supabase
    .from("team_members")
    // Each team's club branding, for the header and team picker (spec: team-branding-and-labels).
    .select("*, teams(*, organizations(name, org_name_public, logo_url, plan)), profiles(*)")
    .in("profile_id", [userId, ...managedProfiles.map((m) => m.profile.id)])
    .order("created_at");
  const allMemberships = (rows ?? []) as unknown as ActiveContextMembership[];

  const choice = chooseContext({
    userId,
    ownProfile: ownProfile ?? null,
    managed: managedProfiles.map((m) => m.profile),
    memberships: allMemberships,
    saved,
    legacyProfileId,
  });
  const failed = !!(ownError || linksError || membershipsError);
  const activeProfile =
    choice.profileId === userId
      ? (ownProfile ?? null)
      : (managedProfiles.find((m) => m.profile.id === choice.profileId)?.profile ?? null);

  return {
    ownProfile: ownProfile ?? null,
    managedProfiles,
    allMemberships,
    activeProfileId: choice.profileId,
    activeProfile,
    activeMembership: choice.membership,
    save: failed ? null : choice.save,
  };
});
