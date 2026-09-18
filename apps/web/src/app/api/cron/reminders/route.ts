import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { resolveRecipients } from "@/lib/notifications/recipients";
import { createServerClient } from "@supabase/ssr";
import { sendEmail, buildEventEmailHtml } from "@/lib/notifications/email";
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
  teams: { name: string; timezone: string | null };
  locations: { name: string } | null;
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
    .select("*, teams(name, timezone), locations(name)")
    .eq("is_cancelled", false)
    .gte("start_time", now.toISOString())
    .lte("start_time", in24h.toISOString());

  if (error || !rawEvents) {
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }

  const events = rawEvents as EventWithTeam[];
  let sent = 0;

  for (const event of events) {
    const teamName = event.teams?.name ?? "Unknown";
    // The server runs in UTC: format in the team's timezone, and name the event's
    // actual day rather than assuming "tomorrow" (BUG-020).
    const timeZone = resolveTimeZone(event.teams?.timezone);
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

    const emailHtml = buildEventEmailHtml({
      eventTitle: event.title,
      eventType: event.event_type,
      startTime: event.start_time,
      endTime: event.end_time,
      location: event.locations?.name ?? null,
      teamName,
      action: "reminder",
      arrivalTime: event.arrival_time,
      eventUrl: `${appUrl}/dashboard/schedule/${event.id}`,
      timeZone,
    });

    const reminderPayload = {
      title: `Reminder: ${event.title}`,
      body: `${dayLabel.charAt(0).toUpperCase()}${dayLabel.slice(1)} at ${formatEventTime(event.start_time, timeZone)}${event.locations?.name ? ` — ${event.locations.name}` : ""}`,
      url: `/dashboard/schedule/${event.id}`,
    };

    for (const recipient of recipients) {
      if (recipient.emailEnabled) {
        for (const email of recipient.emails) {
          try {
            await sendEmail({
              to: email,
              subject: `Reminder: ${event.title} ${relativeDay ?? `on ${dayLabel}`}`,
              html: emailHtml,
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
