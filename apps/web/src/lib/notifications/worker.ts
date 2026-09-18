/**
 * Drains the notification job queue (BUG-006, decision D3).
 *
 * Jobs are enqueued by the database, in the same transaction as the schedule
 * change (supabase/migrations/20260917000007_notification_jobs.sql). This is the
 * other half: claim them, work out who to tell, send, and record what happened
 * per recipient so "skipped because they opted out" is never reported as a
 * failure.
 *
 * It runs as the service role. The old fan-out ran under the caller's own RLS,
 * which hid other people's push tokens from it (BUG-007); resolving recipients
 * here reaches the whole team, guardians of managed players included.
 */

import { adminClient } from "@/lib/api-auth";
import {
  sendEmail,
  buildEventEmailHtml,
  buildSeriesUpdateEmailHtml,
} from "@/lib/notifications/email";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendExpoPushNotification } from "@/lib/notifications/expo-push";
import { formatEventTime, formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";
import {
  planDeliveries,
  summarizeDeliveries,
  jobSubject,
  templateAction,
  bulkChanges,
  type DeliveryOutcome,
  type NotificationJob,
  type PushTarget,
  type Recipient,
} from "@/lib/notifications/dispatch";

type Db = ReturnType<typeof adminClient>;

const BATCH_SIZE = 20;

export async function drainNotificationJobs(limit = BATCH_SIZE) {
  const db = adminClient();

  const { data: claimed, error } = await db.rpc("claim_notification_jobs", { p_limit: limit });
  if (error) throw new Error(`Could not claim notification jobs: ${error.message}`);

  const jobs = (claimed ?? []) as unknown as NotificationJob[];
  const results = [] as { jobId: string; status: string; sent: number; failed: number; skipped: number }[];

  for (const job of jobs) {
    results.push(await runJob(db, job));
  }

  return { claimed: jobs.length, results };
}

async function runJob(db: Db, job: NotificationJob) {
  try {
    const team = await loadTeam(db, job.team_id);
    const recipients = await loadRecipients(db, job.team_id);
    const planned = planDeliveries(recipients);

    const timeZone = resolveTimeZone(team.timezone);
    const subject = jobSubject(job);
    const html = buildJobEmail(job, team.name, timeZone);
    const pushPayload = {
      title: subject,
      body: buildPushBody(job, timeZone),
      url: job.event_id ? `/dashboard/schedule/${job.event_id}` : "/dashboard/schedule",
    };

    const outcomes: DeliveryOutcome[] = [];
    for (const item of planned) {
      if (item.skipReason) {
        outcomes.push({ ...toRow(item), status: "skipped", reason: item.skipReason });
        continue;
      }
      try {
        if (item.channel === "email") {
          await sendEmail({ to: item.target, subject, html });
        } else {
          await sendPush(item.push!, pushPayload);
        }
        outcomes.push({ ...toRow(item), status: "sent", reason: null });
      } catch (err) {
        outcomes.push({
          ...toRow(item),
          status: "failed",
          reason: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
        });
      }
    }

    const summary = summarizeDeliveries(outcomes);

    if (outcomes.length > 0) {
      await db.from("notification_deliveries").insert(
        outcomes.map((o) => ({ job_id: job.id, ...o }))
      );
    }
    await db
      .from("notification_jobs")
      .update({
        status: summary.status,
        sent_at: new Date().toISOString(),
        last_error: summary.failed > 0 ? `${summary.failed} deliveries failed` : null,
      })
      .eq("id", job.id);

    return { jobId: job.id, ...summary };
  } catch (err) {
    // The claim already counted the attempt, so a job that keeps throwing stops
    // being retried after five tries rather than spinning.
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    await db
      .from("notification_jobs")
      .update({ status: job.attempts >= 5 ? "failed" : "pending", last_error: message })
      .eq("id", job.id);
    return { jobId: job.id, status: "failed", sent: 0, failed: 0, skipped: 0 };
  }
}

function toRow(item: { profile_id: string; channel: "email" | "push"; target: string }) {
  return { profile_id: item.profile_id, channel: item.channel, target: item.target || null } as {
    profile_id: string;
    channel: "email" | "push";
    target: string;
  };
}

function sendPush(target: PushTarget, payload: { title: string; body: string; url: string }) {
  if (target.kind === "expo") return sendExpoPushNotification(target.token, payload);
  return sendPushNotification(
    { endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth },
    payload
  );
}

async function loadTeam(db: Db, teamId: string) {
  const { data } = await db.from("teams").select("name, timezone").eq("id", teamId).single();
  return { name: data?.name ?? "Your team", timezone: data?.timezone ?? null };
}

/**
 * Everyone on the team, with the addresses that actually reach them. A managed
 * player has no inbox and no device of their own, so their guardians stand in.
 */
async function loadRecipients(db: Db, teamId: string): Promise<Recipient[]> {
  const { data: rawMembers } = await db
    .from("team_members")
    .select("profile_id, profiles(email, auth_user_id)")
    .eq("team_id", teamId);

  const members = (rawMembers ?? []) as {
    profile_id: string;
    profiles: { email: string; auth_user_id: string | null } | null;
  }[];
  if (members.length === 0) return [];

  const managedIds = members.filter((m) => m.profiles?.auth_user_id == null).map((m) => m.profile_id);

  const guardiansByChild = new Map<string, { id: string; email: string }[]>();
  if (managedIds.length > 0) {
    const { data: links } = await db
      .from("profile_managers")
      .select("managed_id, manager_id, profiles!manager_id(email)")
      .in("managed_id", managedIds);

    for (const link of links ?? []) {
      const email = (link.profiles as unknown as { email: string } | null)?.email;
      if (!email) continue;
      const list = guardiansByChild.get(link.managed_id) ?? [];
      list.push({ id: link.manager_id, email });
      guardiansByChild.set(link.managed_id, list);
    }
  }

  const pushProfileIds = [
    ...members.map((m) => m.profile_id),
    ...[...guardiansByChild.values()].flatMap((gs) => gs.map((g) => g.id)),
  ];

  const [{ data: prefs }, { data: subs }] = await Promise.all([
    db.from("notification_preferences").select("*").in("profile_id", members.map((m) => m.profile_id)),
    db.from("push_subscriptions").select("*").in("profile_id", pushProfileIds),
  ]);

  const prefsByProfile = new Map((prefs ?? []).map((p) => [p.profile_id, p]));
  const subsByProfile = new Map<string, PushTarget[]>();
  for (const sub of subs ?? []) {
    const target: PushTarget | null = sub.expo_push_token
      ? { kind: "expo", token: sub.expo_push_token }
      : sub.endpoint && sub.p256dh && sub.auth
      ? { kind: "web", endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }
      : null;
    if (!target || !sub.profile_id) continue;
    const list = subsByProfile.get(sub.profile_id) ?? [];
    list.push(target);
    subsByProfile.set(sub.profile_id, list);
  }

  return members.map((m) => {
    const guardians = guardiansByChild.get(m.profile_id) ?? [];
    const isManaged = m.profiles?.auth_user_id == null;
    const pref = prefsByProfile.get(m.profile_id);

    return {
      profileId: m.profile_id,
      emails: isManaged
        ? guardians.map((g) => g.email)
        : m.profiles?.email
        ? [m.profiles.email]
        : [],
      pushTargets: isManaged
        ? guardians.flatMap((g) => subsByProfile.get(g.id) ?? [])
        : subsByProfile.get(m.profile_id) ?? [],
      // No preference row, or a null column, means the default: channel on.
      emailEnabled: pref?.email_enabled ?? true,
      pushEnabled: pref?.push_enabled ?? true,
    };
  });
}

function buildJobEmail(job: NotificationJob, teamName: string, timeZone: string): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000");

  // A bulk operation gets one summary for the team rather than one mail per
  // occurrence, so it uses the series template.
  if (job.occurrence_count > 1) {
    return buildSeriesUpdateEmailHtml({
      eventTitle: job.snapshot.title,
      teamName,
      changes: bulkChanges(job),
    });
  }

  return buildEventEmailHtml({
    eventTitle: job.snapshot.title,
    eventType: job.snapshot.event_type ?? "other",
    startTime: job.snapshot.start_time,
    endTime: job.snapshot.end_time,
    location: job.snapshot.location_name,
    teamName,
    action: templateAction(job.action),
    arrivalTime: job.snapshot.arrival_time,
    eventUrl: job.event_id ? `${appUrl}/dashboard/schedule/${job.event_id}` : `${appUrl}/dashboard/schedule`,
    timeZone,
  });
}

function buildPushBody(job: NotificationJob, timeZone: string): string {
  if (job.occurrence_count > 1) {
    return `${job.occurrence_count} events in this series have changed`;
  }
  const when = `${formatShortEventDate(job.snapshot.start_time, timeZone)} at ${formatEventTime(
    job.snapshot.start_time,
    timeZone
  )}`;
  const where = job.snapshot.location_name ? ` — ${job.snapshot.location_name}` : "";
  return `${when}${where}`;
}
