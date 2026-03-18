import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sendEmail, buildEventEmailHtml } from "@/lib/notifications/email";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendExpoPushNotification } from "@/lib/notifications/expo-push";
import type { Database } from "@/types/database";

type EventWithTeam = Database["public"]["Tables"]["events"]["Row"] & {
  teams: { name: string };
  locations: { name: string } | null;
};
type MemberWithProfile = {
  profile_id: string;
  profiles: { email: string; auth_user_id: string | null } | null;
};

// Vercel Cron: runs daily, sends reminders for events happening in the next 24h
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    .select("*, teams(name), locations(name)")
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
    const teamName = (event.teams as { name: string })?.name ?? "Unknown";

    // Get team members
    const { data: rawMembers } = await supabase
      .from("team_members")
      .select("profile_id, profiles(email, auth_user_id)")
      .eq("team_id", event.team_id!);

    if (!rawMembers) continue;
    const members = rawMembers as unknown as MemberWithProfile[];

    const profileIds = members.map((m) => m.profile_id);

    // Resolve manager emails for managed profiles
    const managedProfileIds = members
      .filter((m) => m.profiles?.auth_user_id == null)
      .map((m) => m.profile_id);

    const managerEmailsByProfileId = new Map<string, string[]>();
    if (managedProfileIds.length > 0) {
      const { data: managerLinks } = await supabase
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

    // Get notification preferences
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .in("profile_id", profileIds);

    const prefsMap = new Map(prefs?.map((p) => [p.profile_id, p]));

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
    });

    // Send emails to members who have email enabled
    for (const member of members) {
      const pref = prefsMap.get(member.profile_id);
      if (pref && !pref.email_enabled) continue;

      const isManaged = member.profiles?.auth_user_id == null;
      const emails = isManaged
        ? (managerEmailsByProfileId.get(member.profile_id) ?? [])
        : member.profiles?.email
        ? [member.profiles.email]
        : [];

      for (const email of emails) {
        try {
          await sendEmail({
            to: email,
            subject: `Reminder: ${event.title} tomorrow`,
            html: emailHtml,
          });
          sent++;
        } catch (err) {
          console.error(`Reminder email to ${email} failed:`, err);
        }
      }
    }

    // Send push notifications
    const { data: pushSubs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .in("profile_id", profileIds);

    const reminderPayload = {
      title: `Reminder: ${event.title}`,
      body: `Tomorrow at ${new Date(event.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${event.locations?.name ? ` — ${event.locations.name}` : ""}`,
      url: `/dashboard/schedule/${event.id}`,
    };

    for (const sub of pushSubs ?? []) {
      const pref = prefsMap.get(sub.profile_id);
      if (pref && !pref.push_enabled) continue;

      try {
        if (sub.expo_push_token) {
          await sendExpoPushNotification(sub.expo_push_token, reminderPayload);
        } else {
          await sendPushNotification(
            { endpoint: sub.endpoint!, p256dh: sub.p256dh!, auth: sub.auth! },
            reminderPayload
          );
        }
        sent++;
      } catch (err) {
        console.error("Push reminder failed:", err);
      }
    }
  }

  return NextResponse.json({
    success: true,
    eventsProcessed: events.length,
    notificationsSent: sent,
  });
}
