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
import { resolveRecipients } from "@/lib/notifications/recipients";
import {
  planDeliveries,
  summarizeDeliveries,
  jobSubject,
  templateAction,
  bulkChanges,
  type ChatSnapshot,
  type DeliveryOutcome,
  type NotificationJob,
  type PushTarget,
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
    const isChat = job.kind === "chat";
    const team = await loadTeam(db, job.team_id);

    // Chat is addressed to named members; an event notice goes to the team. Either
    // way the resolver expands managed players to their guardians and applies each
    // receiving adult's own preferences (BUG-007, D2).
    const recipients = await resolveRecipients(db, {
      category: isChat ? "chat" : "event",
      teamId: isChat ? undefined : job.team_id,
      profileIds: isChat ? job.recipient_profile_ids ?? [] : undefined,
    });
    const planned = planDeliveries(recipients, isChat ? ["push"] : ["email", "push"]);

    const timeZone = resolveTimeZone(team.timezone);
    const chat = isChat ? (job.snapshot as unknown as ChatSnapshot) : null;
    const subject = chat ? chat.title : jobSubject(job);
    const html = chat ? "" : buildJobEmail(job, team.name, timeZone);
    const pushPayload = chat
      ? { title: chat.title, body: chat.body, url: chat.url }
      : {
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
