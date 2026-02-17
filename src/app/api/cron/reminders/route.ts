import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sendEmail, buildEventEmailHtml } from "@/lib/notifications/email";
import { sendPushNotification } from "@/lib/notifications/push";
import type { Database } from "@/types/database";

type EventWithTeam = Database["public"]["Tables"]["events"]["Row"] & {
  teams: { name: string };
};
type MemberWithProfile = {
  profile_id: string;
  profiles: { email: string } | null;
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
    .select("*, teams(name)")
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
      .select("profile_id, profiles(email)")
      .eq("team_id", event.team_id);

    if (!rawMembers) continue;
    const members = rawMembers as unknown as MemberWithProfile[];

    const profileIds = members.map((m) => m.profile_id);

    // Get notification preferences
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .in("profile_id", profileIds);

    const prefsMap = new Map(prefs?.map((p) => [p.profile_id, p]));

    const emailHtml = buildEventEmailHtml({
      eventTitle: event.title,
      eventType: event.event_type,
      startTime: event.start_time,
      endTime: event.end_time,
      location: event.location,
      teamName,
      action: "reminder",
    });

    // Send emails to members who have email enabled
    for (const member of members) {
      const pref = prefsMap.get(member.profile_id);
      if (pref && !pref.email_enabled) continue;

      const email = member.profiles?.email;
      if (email) {
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

    for (const sub of pushSubs ?? []) {
      const pref = prefsMap.get(sub.profile_id);
      if (pref && !pref.push_enabled) continue;

      try {
        await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          {
            title: `Reminder: ${event.title}`,
            body: `Tomorrow at ${new Date(event.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${event.location ? ` — ${event.location}` : ""}`,
            url: `/dashboard/schedule/${event.id}`,
          }
        );
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
