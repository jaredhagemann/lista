/**
 * Who a notification reaches (BUG-007, decision D2).
 *
 * Two things were wrong before. The routes asked the **caller's** client for
 * recipients and preferences, and `push_subscriptions` RLS only ever shows you
 * your own rows — so a coach's client could see the coach's tokens and nobody
 * else's. And the audience was the roster, which is not the same as the people:
 * a managed player has no inbox and no device, while the guardian who does may
 * have no roster row at all.
 *
 * Resolution therefore runs as the service role and is centred on the adult who
 * receives:
 *
 *   - a member with their own login is their own recipient
 *   - a managed player resolves to their guardians
 *   - an adult covering two children on the team is resolved once (D2: no
 *     repeated generic alerts down duplicate paths)
 *   - each adult's **own** preferences decide, superseding the archived rule
 *     where a child's row spoke for everyone managing them
 *
 * Only people on the roster (or the named list) are reached: an org director
 * does not become a subscriber through administrative access.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PushTarget } from "@/lib/notifications/dispatch";

type Db = SupabaseClient<Database>;

/** Event notices use the email/push preferences; chat push has its own, and never emails. */
export type NotificationCategory = "event" | "chat";

export type ResolvedRecipient = {
  /** The adult account that will be contacted. */
  profileId: string;
  /** Themselves, and any managed player this notice is on behalf of. */
  coversProfileIds: string[];
  emails: string[];
  pushTargets: PushTarget[];
  emailEnabled: boolean;
  pushEnabled: boolean;
};

export async function resolveRecipients(
  db: Db,
  opts: {
    category: NotificationCategory;
    /** Everyone on this team. */
    teamId?: string;
    /** Or these members specifically — chat channel members, a DM partner. */
    profileIds?: string[];
    /** Adults to leave out, typically whoever caused the notification. */
    excludeProfileIds?: string[];
  }
): Promise<ResolvedRecipient[]> {
  const memberIds = opts.teamId
    ? await teamMemberIds(db, opts.teamId)
    : [...new Set(opts.profileIds ?? [])];
  if (memberIds.length === 0) return [];

  const { data: profiles } = await db
    .from("profiles")
    .select("id, email, auth_user_id")
    .in("id", memberIds);

  const managedIds = (profiles ?? []).filter((p) => p.auth_user_id == null).map((p) => p.id);

  // adult profile id → the member profiles this notice covers for them
  const covers = new Map<string, Set<string>>();
  const cover = (adultId: string, memberId: string) => {
    const set = covers.get(adultId) ?? new Set<string>();
    set.add(memberId);
    covers.set(adultId, set);
  };

  for (const profile of profiles ?? []) {
    if (profile.auth_user_id != null) cover(profile.id, profile.id);
  }

  if (managedIds.length > 0) {
    const { data: links } = await db
      .from("profile_managers")
      .select("managed_id, manager_id")
      .in("managed_id", managedIds);

    for (const link of links ?? []) {
      if (link.manager_id === link.managed_id) continue;
      cover(link.manager_id, link.managed_id);
    }
  }

  for (const excluded of opts.excludeProfileIds ?? []) covers.delete(excluded);
  const adultIds = [...covers.keys()];
  if (adultIds.length === 0) return [];

  const [{ data: adults }, { data: prefs }, { data: subs }] = await Promise.all([
    db.from("profiles").select("id, email").in("id", adultIds),
    db.from("notification_preferences").select("*").in("profile_id", adultIds),
    db.from("push_subscriptions").select("*").in("profile_id", adultIds),
  ]);

  const emailById = new Map((adults ?? []).map((a) => [a.id, a.email]));
  const prefsById = new Map((prefs ?? []).map((p) => [p.profile_id, p]));
  const devicesById = new Map<string, PushTarget[]>();
  for (const sub of subs ?? []) {
    if (!sub.profile_id) continue;
    const target: PushTarget | null = sub.expo_push_token
      ? { kind: "expo", token: sub.expo_push_token }
      : sub.endpoint && sub.p256dh && sub.auth
      ? { kind: "web", endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }
      : null;
    if (!target) continue;
    devicesById.set(sub.profile_id, [...(devicesById.get(sub.profile_id) ?? []), target]);
  }

  return adultIds.map((adultId) => {
    const pref = prefsById.get(adultId);
    const email = emailById.get(adultId);
    const isChat = opts.category === "chat";

    return {
      profileId: adultId,
      coversProfileIds: [...(covers.get(adultId) ?? [])],
      emails: email ? [email] : [],
      pushTargets: devicesById.get(adultId) ?? [],
      // A missing row, or a null column, means the default: on.
      // Chat never emails per message (D2); its digest is a separate feature.
      emailEnabled: isChat ? false : pref?.email_enabled ?? true,
      pushEnabled: isChat ? pref?.chat_push_enabled ?? true : pref?.push_enabled ?? true,
    };
  });
}

async function teamMemberIds(db: Db, teamId: string): Promise<string[]> {
  const { data } = await db.from("team_members").select("profile_id").eq("team_id", teamId);
  return (data ?? []).map((m) => m.profile_id).filter((id): id is string => id != null);
}
