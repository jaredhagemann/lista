import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./email";
import { renderTeamDeletionEmail } from "@/emails/team-deletion-email";
import { sendPushNotification } from "./push";
import { sendExpoPushNotification } from "./expo-push";
import type { Database } from "@/types/database";

/**
 * A self-contained snapshot of who to notify about a team deletion, gathered
 * from the DB BEFORE the team is deleted (members, managers, and push
 * subscriptions all cascade away on delete). Passing this to
 * sendTeamDeletionNotifications() after the delete commits means no post-delete
 * DB reads are needed.
 */
export type TeamDeletionRecipients = {
  teamName: string;
  /** Flat list of email addresses to notify (already filtered by preference). */
  emails: string[];
  /** Push subscriptions to notify (already filtered by preference). */
  pushSubs: Array<{
    expo_push_token: string | null;
    endpoint: string | null;
    p256dh: string | null;
    auth: string | null;
  }>;
};

/**
 * Gather everyone who should be notified of a team deletion, BEFORE the team
 * (and its members / subscriptions) are removed.
 *
 * Routing rules:
 * - Auth-backed members: email to their own address + push to their subscriptions.
 * - Managed members (auth_user_id IS NULL): email to each of their managers;
 *   push is skipped (managed profiles have no push_subscriptions).
 *
 * Notification preferences are respected per profile_id (default: enabled).
 */
export async function collectTeamDeletionRecipients(
  teamId: string,
  teamName: string
): Promise<TeamDeletionRecipients> {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const empty: TeamDeletionRecipients = { teamName, emails: [], pushSubs: [] };

  // Fetch all current members with their profile details
  const { data: members } = await admin
    .from("team_members")
    .select("profile_id, profiles(email, auth_user_id)")
    .eq("team_id", teamId);

  if (!members || members.length === 0) return empty;

  const profileIds = members.map((m) => m.profile_id).filter(Boolean) as string[];

  // For managed profiles, resolve manager emails via profile_managers
  const managedProfileIds = members
    .filter((m) => (m.profiles as { auth_user_id: string | null } | null)?.auth_user_id == null)
    .map((m) => m.profile_id)
    .filter((id): id is string => id != null);

  const managerEmailsByProfileId = new Map<string, string[]>();
  if (managedProfileIds.length > 0) {
    const { data: managerLinks } = await admin
      .from("profile_managers")
      .select("managed_id, profiles!manager_id(email)")
      .in("managed_id", managedProfileIds);

    for (const link of managerLinks ?? []) {
      const email = (link.profiles as unknown as { email: string } | null)?.email;
      if (email) {
        const existing = managerEmailsByProfileId.get(link.managed_id) ?? [];
        existing.push(email);
        managerEmailsByProfileId.set(link.managed_id, existing);
      }
    }
  }

  // Fetch notification preferences
  const { data: rawPrefs } = await admin
    .from("notification_preferences")
    .select("*")
    .in("profile_id", profileIds);

  const prefsMap = new Map((rawPrefs ?? []).map((p) => [p.profile_id, p]));

  const emails = members
    .filter((m) => {
      const pref = prefsMap.get(m.profile_id);
      return pref ? pref.email_enabled : true;
    })
    .flatMap((m) => {
      const profile = m.profiles as { email: string | null; auth_user_id: string | null } | null;
      const isManaged = profile?.auth_user_id == null;
      return isManaged
        ? m.profile_id
          ? (managerEmailsByProfileId.get(m.profile_id) ?? [])
          : []
        : profile?.email
        ? [profile.email]
        : [];
    });

  // Fetch push subscriptions (only for auth-backed profiles)
  const { data: pushSubs } = await admin
    .from("push_subscriptions")
    .select("*")
    .in("profile_id", profileIds);

  const filteredPushSubs = (pushSubs ?? [])
    .filter((sub) => {
      const pref = prefsMap.get(sub.profile_id);
      return pref ? pref.push_enabled : true;
    })
    .map((sub) => ({
      expo_push_token: sub.expo_push_token,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    }));

  return { teamName, emails, pushSubs: filteredPushSubs };
}

/**
 * Fan out deletion notifications from a pre-gathered recipient snapshot. Call
 * this only AFTER the team delete has committed, so a failed delete never
 * results in a false "Team Deleted" notice. Best-effort: failures are logged,
 * never thrown.
 */
export async function sendTeamDeletionNotifications(
  recipients: TeamDeletionRecipients
): Promise<void> {
  const { teamName, emails, pushSubs } = recipients;
  if (emails.length === 0 && pushSubs.length === 0) return;

  const subject = `${teamName} has been deleted`;
  const email = emails.length > 0 ? await renderTeamDeletionEmail({ teamName }) : null;

  const emailPromises = emails.map((to) =>
    sendEmail({ to, subject, ...email! }).catch((err) =>
      console.error(`[team-deletion] Email to ${to} failed:`, err)
    )
  );

  const pushPayload = {
    title: subject,
    body: `${teamName} has been permanently deleted by the team owner.`,
    url: "/dashboard",
  };

  const pushPromises = pushSubs.map((sub) => {
    if (sub.expo_push_token) {
      return sendExpoPushNotification(sub.expo_push_token, pushPayload).catch((err) =>
        console.error("[team-deletion] Expo push failed:", err)
      );
    }
    return sendPushNotification(
      { endpoint: sub.endpoint!, p256dh: sub.p256dh!, auth: sub.auth! },
      pushPayload
    ).catch((err) => console.error("[team-deletion] Push notification failed:", err));
  });

  await Promise.allSettled([...emailPromises, ...pushPromises]);
}
