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
import { sendEmail } from "@/lib/notifications/email";
import { renderEventEmail, type AnswerRow } from "@/emails/event-email";
import { answerRowsFor, loadAnswerContext, type AnswerContext } from "@/lib/notifications/answers";
import { uniformOf, type TeamUniforms } from "@/lib/events/game-display";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";
import { renderTournamentEmail } from "@/emails/tournament-email";
import {
  isTournamentSnapshot,
  partOfLine,
  tournamentNoticeUrl,
  tournamentPushBody,
} from "@/lib/notifications/tournament-notice";
import { TEAM_BRAND_COLUMNS, teamEmailBrand } from "@/emails/brand";
import type { RenderedEmail } from "@/emails/layout";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendExpoPushNotification, isDeadTokenError } from "@/lib/notifications/expo-push";
import { formatEventTime, formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";
import { resolveRecipients } from "@/lib/notifications/recipients";
import {
  planDeliveries,
  summarizeDeliveries,
  eventNoticeSubject,
  jobSubject,
  templateAction,
  seriesChanges,
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
      // The route drops the sender from the addressed members, but a guardian of
      // a player on the team is resolved back in through their child — and would
      // be pushed the message they just sent. Excluding the author here is the
      // only place that knows about the expansion.
      excludeProfileIds: isChat && job.created_by ? [job.created_by] : undefined,
    });
    const planned = planDeliveries(recipients, isChat ? ["push"] : ["email", "push"]);

    // The event's own zone, else the team's for events and jobs from before event zones (BUG-010).
    const timeZone = resolveTimeZone(isChat ? team.timezone : job.snapshot.timezone ?? team.timezone);
    const chat = isChat ? (job.snapshot as unknown as ChatSnapshot) : null;
    // A tournament reads as one, whatever the job's count (spec §4, Notifications).
    const tournament = !chat && isTournamentSnapshot(job.snapshot);
    const subject = chat
      ? chat.title
      : tournament
        ? eventNoticeSubject(job.action, job.snapshot.title)
        : jobSubject(job, team.name);

    // Each recipient's email carries rows for just their own people, when it
    // asks for availability (§4.7, D8–D10); the answers are read once per job.
    const byProfile = new Map(recipients.map((r) => [r.profileId, r]));
    const answers: AnswerContext | null =
      !chat && asksForAnswers(job)
        ? await loadAnswerContext(db, job.event_id!, recipients.flatMap((r) => r.coversProfileIds))
        : null;
    const emails = new Map<string, Promise<RenderedEmail>>();
    const emailFor = (profileId: string) => {
      if (!emails.has(profileId)) {
        const recipient = byProfile.get(profileId);
        const rows = answers && recipient ? answerRowsFor(recipient, answers, eventUrlOf(job)) : undefined;
        emails.set(profileId, buildJobEmail(job, team, timeZone, rows));
      }
      return emails.get(profileId)!;
    };
    const pushPayload = chat
      ? { title: chat.title, body: chat.body, url: chat.url }
      : {
          title: subject,
          body: tournament ? tournamentPushBody(job, timeZone) : buildPushBody(job, timeZone),
          url: tournament
            ? tournamentNoticeUrl(job, "")
            : job.event_id
              ? `/dashboard/schedule/${job.event_id}`
              : "/dashboard/schedule",
        };

    const outcomes: DeliveryOutcome[] = [];
    for (const item of planned) {
      if (item.skipReason) {
        outcomes.push({ ...toRow(item), status: "skipped", reason: item.skipReason });
        continue;
      }
      try {
        if (item.channel === "email") {
          // Chat plans no email, so an email item always has one.
          await sendEmail({ to: item.target, subject, ...(await emailFor(item.profile_id)), brandName: team.brand.fromName });
        } else {
          await sendPush(item.push!, pushPayload);
        }
        outcomes.push({ ...toRow(item), status: "sent", reason: null });
      } catch (err) {
        // A token the service says is dead never works again: drop it rather
        // than failing against it on every message (BUG-007).
        if (isDeadTokenError(err)) {
          await db.from("push_subscriptions").delete().eq("expo_push_token", item.target);
        }
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
  const { data } = await db
    .from("teams")
    .select(`name, timezone, home_uniform, away_uniform, home_uniform_color, away_uniform_color, ${TEAM_BRAND_COLUMNS}`)
    .eq("id", teamId)
    .single();
  const team = data as ({ name?: string; timezone?: string | null } & TeamUniforms) | null;
  return {
    name: team?.name ?? "Your team",
    timezone: team?.timezone ?? null,
    // A club team's notices come from the club, in its brand (email-upgrade §4.2).
    brand: teamEmailBrand(data),
    uniforms: (team ?? {}) as TeamUniforms,
  };
}

type Team = Awaited<ReturnType<typeof loadTeam>>;

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : "http://localhost:3000")
  );
}

/**
 * Whether a job's email asks for availability (D8): one event, new, changed or
 * back on. Not a cancellation, and not a series summary.
 */
function asksForAnswers(job: NotificationJob): boolean {
  return (
    // A tournament job is one notice for the tournament, whatever its count.
    (job.occurrence_count <= 1 || isTournamentSnapshot(job.snapshot)) &&
    !job.snapshot.series_changes &&
    job.event_id != null &&
    (job.action === "created" || job.action === "updated" || job.action === "restored")
  );
}

function buildJobEmail(job: NotificationJob, team: Team, timeZone: string, answers?: AnswerRow[]): Promise<RenderedEmail> {
  const { name: teamName, brand } = team;
  if (isTournamentSnapshot(job.snapshot)) return buildTournamentEmail(job, team, timeZone, answers);
  // A bulk operation gets one summary for the team rather than one mail per
  // occurrence, so it uses the series template.
  if (job.occurrence_count > 1 || job.snapshot.series_changes) {
    return renderSeriesUpdateEmail({
      eventTitle: job.snapshot.title,
      teamName,
      occurrences: job.occurrence_count,
      // A series edit says what it changed; a bulk update of rows is compared row by row.
      // An event with no zone of its own goes by its team's, before and after (PR #96 re-review).
      changes: job.snapshot.series_changes ?? seriesChanges(job.snapshot.previous, job.snapshot, resolveTimeZone(team.timezone)),
      scheduleUrl: `${appUrl()}/dashboard/schedule`,
      brand,
    });
  }

  return renderEventEmail({
    brand,
    eventTitle: job.snapshot.title,
    eventType: job.snapshot.event_type ?? "other",
    startTime: job.snapshot.start_time,
    endTime: job.snapshot.end_time,
    location: job.snapshot.location_name,
    teamName,
    action: templateAction(job.action),
    arrivalTime: job.snapshot.arrival_time,
    eventUrl: eventUrlOf(job),
    timeZone,
    opponent: job.snapshot.opponent,
    homeAway: job.snapshot.home_away,
    uniform: uniformOf(job.snapshot.uniform, team.uniforms),
    notes: job.snapshot.notes,
    previous: job.snapshot.previous
      ? {
          startTime: job.snapshot.previous.start_time,
          endTime: job.snapshot.previous.end_time,
          arrivalTime: job.snapshot.previous.arrival_time,
          location: job.snapshot.previous.location_name,
          // Its own zone, else its team's, else UTC as it was sent: never the
          // event's new zone (PR #96 re-review). Resolved here, so the template
          // can't fall back to the new one.
          timeZone: resolveTimeZone(job.snapshot.previous.timezone ?? team.timezone),
        }
      : null,
    answers,
    partOf: partOfLine(job.snapshot),
  });
}

/**
 * A tournament's notice: its dates and the games it's about, linking to it,
 * or to the schedule once it's deleted (spec §4, Notifications).
 */
function buildTournamentEmail(job: NotificationJob, team: Team, timeZone: string, answers?: AnswerRow[]) {
  const { snapshot } = job;
  const summary = snapshot.tournament;
  const previous = job.action === "updated" ? snapshot.previous : null;
  return renderTournamentEmail({
    brand: team.brand,
    teamName: team.name,
    title: snapshot.title,
    start_time: snapshot.start_time,
    end_time: snapshot.end_time,
    timeZone,
    location: snapshot.location_name,
    notes: snapshot.notes,
    action: job.action === "message" ? "updated" : job.action,
    games: summary ? { total: summary.games, action: summary.games_action, list: summary.affected_games ?? [] } : undefined,
    previous: previous
      ? {
          start_time: previous.start_time,
          end_time: previous.end_time,
          location: previous.location_name,
          timeZone: resolveTimeZone(previous.timezone ?? team.timezone),
        }
      : null,
    url: tournamentNoticeUrl(job, appUrl()),
    answers,
  });
}

function eventUrlOf(job: NotificationJob) {
  return job.event_id ? `${appUrl()}/dashboard/schedule/${job.event_id}` : `${appUrl()}/dashboard/schedule`;
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
