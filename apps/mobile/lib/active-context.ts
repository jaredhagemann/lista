/**
 * Which person the phone views as, and which team
 * (docs/specs/device-local-active-context.md §6).
 *
 * The phone keeps its own context, saved as one tuple under a SecureStore key
 * of the account's own (D1), so a switch on another device, or by another
 * guardian, never moves it. The shared profiles.active_team_id is only the
 * "last picked" default, read when the phone has no valid context (D2, D3).
 *
 * The rules are the web's (apps/web/src/lib/active-context.ts), copied.
 */

import * as SecureStore from "expo-secure-store";

export type SavedContext = { accountId: string; profileId: string; teamId: string };

/** The key the person alone used to live under. Read once, to seed a context, then retired. */
export const LEGACY_PROFILE_KEY = "active_profile_id";

const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account's own key: one account's context is never another's. */
export function contextKey(accountId: string): string {
  return `lista_context.${accountId}`;
}

export function encodeContext({ accountId, profileId, teamId }: SavedContext): string {
  return [VERSION, accountId, profileId, teamId].join(".");
}

/** The saved context, or null for a missing, malformed or other-version value. */
export function decodeContext(value: string | null | undefined): SavedContext | null {
  const parts = (value ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, accountId, profileId, teamId] = parts;
  if (![accountId, profileId, teamId].every((id) => UUID.test(id))) return null;
  return { accountId, profileId, teamId };
}

// ── The rules ────────────────────────────────────────────────────────────────

export type ContextMembership = {
  profile_id: string | null;
  team_id: string | null;
  /** Null when the team can't be seen. */
  teams: { id: string; archived_at?: string | null } | null;
};

export type ContextChoice<M extends ContextMembership> = {
  profileId: string;
  membership: M | null;
  /** The tuple to save on this device, when what it had is missing or no longer valid; else null. */
  save: SavedContext | null;
};

export type ContextInput<M extends ContextMembership> = {
  userId: string;
  ownProfile: { id: string; active_team_id: string | null } | null;
  managed: { id: string; active_team_id: string | null }[];
  /** The memberships of the account's own and managed profiles, earliest first. */
  memberships: M[];
  saved: SavedContext | null;
  legacyProfileId: string | null;
};

/**
 * The memberships a device's context may name: the account's own and managed
 * people's, on teams that can be seen, passing over archived teams while
 * another exists (D4, D6).
 */
function contextPool<M extends ContextMembership>({ userId, managed, memberships }: ContextInput<M>) {
  const allowed = new Set([userId, ...managed.map((m) => m.id)]);
  const visible = memberships.filter((m) => m.teams && m.profile_id && allowed.has(m.profile_id));
  const current = visible.filter((m) => !m.teams!.archived_at);
  return { allowed, pool: current.length > 0 ? current : visible };
}

/** The membership a context naming this person and team would use, if it may. */
export function usableMembership<M extends ContextMembership>(
  input: ContextInput<M>,
  profileId: string,
  teamId: string
): M | null {
  return contextPool(input).pool.find((m) => m.profile_id === profileId && m.team_id === teamId) ?? null;
}

/**
 * Chooses the device's context. Pure: the reads happen in AppContext.
 *
 *   1. A saved tuple for this account, a profile it may act as and one of that
 *      profile's teams: kept as it is.
 *   2. Otherwise a person, in order: the saved one, the account's own. Each
 *      must be the account's own or managed. The first with a team wins, at
 *      their last-picked team (D2), else their first. Before any tuple was
 *      saved for this account, the old profile key's person comes before
 *      the account's own; after, it's ignored (review DC-002).
 *   3. Otherwise the account's other people, in the order they joined their
 *      teams, by the same rule: a parent with no team of their own views as a
 *      child, at that child's last-picked team. The person follows the team.
 *
 * Archived teams are passed over while another exists (D4).
 */
export function chooseContext<M extends ContextMembership>(input: ContextInput<M>): ContextChoice<M> {
  const { userId, ownProfile, managed, saved, legacyProfileId } = input;
  const { allowed, pool } = contextPool(input);
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
  // The people to try, in order; then the rest of the account's people, in
  // the order they joined their teams (a parent with no team of their own).
  // The old key seeds a first context only: once this account has saved a
  // tuple, a superseded choice must not come back in a repair (DC-002).
  const migrating = !saved || saved.accountId !== userId;
  const people = [savedForMe?.profileId, migrating ? legacyProfileId : null, userId, ...pool.map((m) => m.profile_id)].filter(
    (id, i, all): id is string => !!id && allowed.has(id) && all.indexOf(id) === i
  );
  for (const profileId of people) {
    const membership = (lastPicked(profileId) && find(profileId, lastPicked(profileId))) || find(profileId);
    if (membership) return chosen(membership);
  }

  return { profileId: people[0] ?? userId, membership: null, save: null };
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Every save goes through one queue, in order, so a write still in flight can't
 * land after a newer one. The revision counts saves: an automatic seed or
 * repair carries the revision it read, and is dropped if anything was saved
 * since (review DC-003).
 */
let revision = 0;
let queue: Promise<unknown> = Promise.resolve();

/**
 * What the phone has saved for this account, and the old key, for seeding. A
 * storage failure reads as failed, so nothing is saved over it (D3). The
 * revision is the one an automatic save from this read must still match.
 */
export async function readStoredContext(
  accountId: string
): Promise<{ saved: SavedContext | null; legacyProfileId: string | null; failed: boolean; revision: number }> {
  const at = revision;
  // Reads wait for queued writes, so they see the latest save.
  await queue.catch(() => {});
  if (revision !== at) return readStoredContext(accountId);
  try {
    const [value, legacy] = await Promise.all([
      SecureStore.getItemAsync(contextKey(accountId)),
      SecureStore.getItemAsync(LEGACY_PROFILE_KEY),
    ]);
    const saved = decodeContext(value);
    return { saved: saved?.accountId === accountId ? saved : null, legacyProfileId: legacy || null, failed: false, revision: at };
  } catch {
    return { saved: null, legacyProfileId: null, failed: true, revision: at };
  }
}

type Listener = (context: SavedContext) => void;
const listeners = new Set<Listener>();

/**
 * Hears every saved context. AppContext reloads on it, so a save made outside
 * it (the invitation screen) takes effect. Returns the unsubscribe.
 */
export function onContextSaved(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Saves the phone's context and retires the old key. False if storage failed,
 * or if `ifRevision` is given and something was saved since that read: an
 * automatic seed or repair never replaces a newer save (DC-003). A save without
 * it is the person's own choice, and always goes ahead, after any write in
 * flight.
 */
export function saveContext(context: SavedContext, options: { ifRevision?: number } = {}): Promise<boolean> {
  const automatic = options.ifRevision !== undefined;
  if (!automatic) revision++;
  const write = queue.then(async () => {
    if (automatic) {
      if (options.ifRevision !== revision) return false;
      revision++;
    }
    try {
      await SecureStore.setItemAsync(contextKey(context.accountId), encodeContext(context));
      await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY);
    } catch {
      return false;
    }
    for (const listener of [...listeners]) listener(context);
    return true;
  });
  queue = write.catch(() => {});
  return write;
}
