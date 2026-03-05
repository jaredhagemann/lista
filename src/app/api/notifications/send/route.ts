import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  sendEmail,
  buildEventEmailHtml,
  buildSeriesUpdateEmailHtml,
  type FieldChange,
} from "@/lib/notifications/email";
import { sendPushNotification } from "@/lib/notifications/push";
import type { Database } from "@/types/database";
import { notificationLimiter, rateLimitResponse } from "@/lib/rate-limit";

type EventWithTeam = Database["public"]["Tables"]["events"]["Row"] & {
  teams: { name: string };
  locations: { name: string } | null;
};
type MemberWithProfile = {
  profile_id: string;
  profiles: { email: string } | null;
};
type NotificationPref = Database["public"]["Tables"]["notification_preferences"]["Row"];
type PushSubscription = Database["public"]["Tables"]["push_subscriptions"]["Row"];

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await notificationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const { eventId, action, changes } = body as {
    eventId: string;
    action: "created" | "updated" | "cancelled" | "reminder" | "series_updated";
    changes?: FieldChange[];
  };

  // Fetch event details
  const { data: rawEvent, error: eventError } = await supabase
    .from("events")
    .select("*, teams(name), locations(name)")
    .eq("id", eventId)
    .single();

  if (eventError || !rawEvent) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const event = rawEvent as EventWithTeam;
  const teamName = event.teams?.name ?? "Unknown Team";

  // Get all team members
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("profile_id, profiles(email)")
    .eq("team_id", event.team_id!);

  if (!rawMembers) {
    return NextResponse.json({ error: "No members found" }, { status: 404 });
  }

  const members = rawMembers as MemberWithProfile[];
  const profileIds = members.map((m) => m.profile_id);

  // Get notification preferences
  const { data: rawPrefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .in("profile_id", profileIds);

  const prefs = (rawPrefs ?? []) as NotificationPref[];
  const prefsMap = new Map(prefs.map((p) => [p.profile_id, p]));

  // Build email content
  const isSeriesUpdate = action === "series_updated";
  const emailSubject = isSeriesUpdate
    ? `Schedule updated: ${event.title}`
    : `${action === "created" ? "New" : action === "cancelled" ? "Cancelled" : action === "reminder" ? "Reminder" : "Updated"}: ${event.title}`;

  const emailHtml = isSeriesUpdate
    ? buildSeriesUpdateEmailHtml({
        eventTitle: event.title,
        teamName,
        changes: changes ?? [],
      })
    : buildEventEmailHtml({
        eventTitle: event.title,
        eventType: event.event_type,
        startTime: event.start_time,
        endTime: event.end_time,
        location: event.locations?.name ?? null,
        teamName,
        action: action as "created" | "updated" | "cancelled" | "reminder",
        arrivalTime: event.arrival_time,
      });

  // Send emails
  const emailPromises = members
    .filter((m) => {
      const pref = prefsMap.get(m.profile_id);
      return pref ? pref.email_enabled : true; // Default to enabled
    })
    .map((m) => {
      const email = m.profiles?.email;
      if (email) {
        return sendEmail({
          to: email,
          subject: emailSubject,
          html: emailHtml,
        }).catch((err) => console.error(`Email to ${email} failed:`, err));
      }
    });

  // Send push notifications
  const { data: rawPushSubs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("profile_id", profileIds);

  const pushSubs = (rawPushSubs ?? []) as PushSubscription[];
  const pushBody = isSeriesUpdate
    ? `${event.title} schedule has been updated`
    : `${new Date(event.start_time).toLocaleDateString()} at ${new Date(event.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${event.locations?.name ? ` — ${event.locations.name}` : ""}`;

  const pushPromises =
    pushSubs
      .filter((sub) => {
        const pref = prefsMap.get(sub.profile_id);
        return pref ? pref.push_enabled : true;
      })
      .map((sub) =>
        sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          {
            title: emailSubject,
            body: pushBody,
            url: `/dashboard/schedule/${event.id}`,
          }
        ).catch((err) => console.error("Push notification failed:", err))
      );

  await Promise.allSettled([...emailPromises, ...pushPromises]);

  return NextResponse.json({ success: true });
}
