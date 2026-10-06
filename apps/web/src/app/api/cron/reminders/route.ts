import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { resolveRecipients } from "@/lib/notifications/recipients";
import { reminderSubject } from "@/lib/notifications/dispatch";
import { createServerClient } from "@supabase/ssr";
import { sendEmail } from "@/lib/notifications/email";
import { renderEventEmail } from "@/emails/event-email";
import { renderTournamentEmail } from "@/emails/tournament-email";
import {
  REMINDER_EVENT_COLUMNS,
  REMINDER_TOURNAMENT_GAME_COLUMNS,
  partOfLine,
  tournamentReminderSubject,
} from "@/lib/notifications/tournament-notice";
import type { TournamentGameSnapshot } from "@/lib/notifications/dispatch";
import { teamEmailBrand, type BrandedTeam } from "@/emails/brand";
import { answerRowsFor, loadAnswerContext } from "@/lib/notifications/answers";
import { gameTitle, uniformOf, type TeamUniforms } from "@/lib/events/game-display";
import { tournamentDates } from "@/lib/events/tournament";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendExpoPushNotification } from "@/lib/notifications/expo-push";
import {
  formatEventTime,
  formatShortEventDate,
  relativeEventDay,
  resolveTimeZone,
} from "@/lib/notifications/event-time";
import type { Database } from "@/types/database";

type EventWithTeam = Database["public"]["Tables"]["events"]["Row"] & {
  teams: ({ name: string; timezone: string | null } & BrandedTeam & TeamUniforms) | null;
  locations: { name: string } | null;
  /** A game's tournament, for "Part of Surf Cup". */
  tournament: { title: string } | null;
};


// Vercel Cron: runs daily, sends reminders for events happening in the next 24h
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role for cron to bypass RLS
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find events in the next 24 hours that aren't cancelled
  const { data: rawEvents, error } = await supabase
    .from("events")
    .select(REMINDER_EVENT_COLUMNS)
    .eq("is_cancelled", false)
    .gte("start_time", now.toISOString())
    .lte("start_time", in24h.toISOString());

  if (error || !rawEvents) {
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }

  // Through unknown: the typed client can't resolve the self-embed on tournament_id.
  const events = rawEvents as unknown as EventWithTeam[];
  let sent = 0;

  for (const event of events) {
    const teamName = event.teams?.name ?? "Unknown";
    // The server runs in UTC: format in the event's own zone (else the team's,
    // for events from before event zones), and name the event's actual day
    // rather than assuming "tomorrow" (BUG-020, BUG-010).
    const timeZone = resolveTimeZone(event.timezone ?? event.teams?.timezone);
    const relativeDay = relativeEventDay(event.start_time, timeZone);
    const dayLabel = relativeDay ?? formatShortEventDate(event.start_time, timeZone);

    // Everyone the reminder is for: teammates, and the guardians of managed
    // players, who may have no roster row of their own. Each receiving adult's
    // own preferences apply (BUG-007, D2).
    const recipients = await resolveRecipients(supabase, {
      category: "event",
      teamId: event.team_id!,
    });

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : "http://localhost:3000");

    // A club team's reminder comes from the club, in its brand (email-upgrade §4.2).
    const brand = teamEmailBrand(event.teams);
    // "12U Girls @ Rivals FC" for a game, as the app names it (email-upgrade §4.3).
    const title = gameTitle(event, teamName, { includeScore: false });
    const eventUrl = `${appUrl}/dashboard/schedule/${event.id}`;

    // Each person's current answer, read once for the event; every recipient's
    // email then carries rows for just their own people (§4.7, D9–D10).
    const answers = await loadAnswerContext(
      supabase,
      event.id,
      recipients.flatMap((r) => r.coversProfileIds)
    );
    // A tournament reads as one, with its games (D6): "Surf Cup starts tomorrow · 5 games".
    const isTournament = event.event_type === "tournament";
    const games: TournamentGameSnapshot[] = isTournament
      ? (((
          await supabase
            .from("events")
            .select(REMINDER_TOURNAMENT_GAME_COLUMNS)
            .eq("tournament_id", event.id)
            .order("start_time", { ascending: true })
        ).data ?? []) as TournamentGameSnapshot[])
      : [];
    const playing = games.filter((g) => !g.is_cancelled).length;
    const gamesPhrase = playing > 0 ? `${playing} ${playing === 1 ? "game" : "games"}` : null;

    const emailFor = (recipient: (typeof recipients)[number]) =>
      isTournament
        ? renderTournamentEmail({
            brand,
            teamName,
            title: event.title,
            start_time: event.start_time,
            end_time: event.end_time,
            timeZone,
            location: event.locations?.name ?? null,
            notes: event.notes,
            action: "reminder",
            games: { total: playing, action: "created", list: games },
            url: eventUrl,
            answers: answerRowsFor(recipient, answers, eventUrl),
          })
        : renderEventEmail({
            eventTitle: event.title,
            eventType: event.event_type,
            startTime: event.start_time,
            endTime: event.end_time,
            location: event.locations?.name ?? null,
            teamName,
            action: "reminder",
            brand,
            arrivalTime: event.arrival_time,
            eventUrl,
            timeZone,
            opponent: event.opponent,
            homeAway: event.home_away,
            uniform: uniformOf(event.uniform, event.teams ?? {}),
            notes: event.notes,
            answers: answerRowsFor(recipient, answers, eventUrl),
            partOf: partOfLine({ tournament_title: event.tournament?.title, round: event.round }),
          });

    const subject = isTournament
      ? tournamentReminderSubject(event.title, relativeDay, dayLabel)
      : reminderSubject(title, relativeDay, dayLabel);
    const where = event.locations?.name ? ` — ${event.locations.name}` : "";
    const reminderPayload = isTournament
      ? {
          title: subject,
          body: `${gamesPhrase ?? tournamentDates(event, timeZone)}${where}`,
          url: `/dashboard/schedule/${event.id}`,
        }
      : {
          title: `Reminder: ${title}`,
          body: `${dayLabel.charAt(0).toUpperCase()}${dayLabel.slice(1)} at ${formatEventTime(event.start_time, timeZone)}${where}`,
          url: `/dashboard/schedule/${event.id}`,
        };

    for (const recipient of recipients) {
      if (recipient.emailEnabled && recipient.emails.length > 0) {
        const message = await emailFor(recipient);
        for (const email of recipient.emails) {
          try {
            await sendEmail({
              to: email,
              subject,
              ...message,
              brandName: brand.fromName,
            });
            sent++;
          } catch (err) {
            console.error(`Reminder email to ${email} failed:`, err);
          }
        }
      }

      if (!recipient.pushEnabled) continue;
      // Every device the person has registered, not just the most recent one.
      for (const target of recipient.pushTargets) {
        try {
          if (target.kind === "expo") {
            await sendExpoPushNotification(target.token, reminderPayload);
          } else {
            await sendPushNotification(
              { endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth },
              reminderPayload
            );
          }
          sent++;
        } catch (err) {
          console.error("Push reminder failed:", err);
        }
      }
    }
  }

  // Sweep up schedule-change notices whose immediate send never happened — a
  // closed tab, a provider outage (BUG-006). /api/cron/notifications sweeps at
  // midnight too; doing it here as well costs one query and halves how long a
  // stranded notice can sit, because this plan allows only one run per day per
  // cron job.
  let drained = { claimed: 0 };
  try {
    drained = await drainNotificationJobs(100);
  } catch (err) {
    console.error("Notification drain failed:", err);
  }

  return NextResponse.json({
    success: true,
    eventsProcessed: events.length,
    notificationsSent: sent,
    notificationJobsDrained: drained.claimed,
  });
}
