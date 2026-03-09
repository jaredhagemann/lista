import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/notifications/push";
import type { Database } from "@/types/database";
import { notificationLimiter, rateLimitResponse } from "@/lib/rate-limit";

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
  const { messageId, channelId, dmChannelId } = body as {
    messageId: string;
    channelId?: string;
    dmChannelId?: string;
  };

  if (!messageId || (!channelId && !dmChannelId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fetch the message and sender profile
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .select("id, body, sender_id, profiles!sender_id(first_name, last_name)")
    .eq("id", messageId)
    .single();

  if (msgError || !message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const sender = message.profiles as unknown as { first_name: string; last_name: string } | null;
  const senderName = sender
    ? [sender.first_name, sender.last_name].filter(Boolean).join(" ")
    : "Someone";

  // Determine recipient profile IDs (excluding sender)
  let recipientProfileIds: string[] = [];
  let channelLabel = "Team Chat";

  if (channelId) {
    // Team or group channel
    const { data: channel } = await supabase
      .from("channels")
      .select("type, name, team_id")
      .eq("id", channelId)
      .single();

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    channelLabel = channel.name;

    if (channel.type === "team") {
      const { data: members } = await supabase
        .from("team_members")
        .select("profile_id")
        .eq("team_id", channel.team_id);

      recipientProfileIds = (members ?? [])
        .map((m) => m.profile_id)
        .filter((id): id is string => id !== null && id !== user.id);
    } else {
      // Group channel
      const { data: members } = await supabase
        .from("channel_members")
        .select("profile_id")
        .eq("channel_id", channelId);

      recipientProfileIds = (members ?? [])
        .map((m) => m.profile_id)
        .filter((id) => id !== user.id);
    }
  } else if (dmChannelId) {
    const { data: dm } = await supabase
      .from("dm_channels")
      .select("profile_a, profile_b")
      .eq("id", dmChannelId)
      .single();

    if (!dm) {
      return NextResponse.json({ error: "DM channel not found" }, { status: 404 });
    }

    const otherId = dm.profile_a === user.id ? dm.profile_b : dm.profile_a;
    recipientProfileIds = [otherId];
    channelLabel = `${senderName}`;
  }

  if (recipientProfileIds.length === 0) {
    return NextResponse.json({ success: true });
  }

  // Get notification preferences
  const { data: rawPrefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .in("profile_id", recipientProfileIds);

  const prefsMap = new Map(
    ((rawPrefs ?? []) as NotificationPref[]).map((p) => [p.profile_id, p])
  );

  // Get push subscriptions for eligible recipients
  const pushEnabledIds = recipientProfileIds.filter((id) => {
    const pref = prefsMap.get(id);
    return pref ? pref.chat_push_enabled : true; // Default enabled
  });

  const { data: rawPushSubs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("profile_id", pushEnabledIds);

  const pushSubs = (rawPushSubs ?? []) as PushSubscription[];

  // Truncate body for notification preview
  const bodyPreview =
    message.body.length > 100 ? message.body.slice(0, 97) + "…" : message.body;

  const pushPromises = pushSubs.map((sub) =>
    sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title: channelId ? `${senderName} in ${channelLabel}` : senderName,
        body: bodyPreview,
        url: "/dashboard/chat",
      }
    ).catch((err) => console.error("Chat push notification failed:", err))
  );

  await Promise.allSettled(pushPromises);

  return NextResponse.json({ success: true });
}
