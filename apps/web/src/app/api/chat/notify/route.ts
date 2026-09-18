/**
 * Queues push for a chat message (BUG-007).
 *
 * Two things were wrong. The route resolved recipients and preferences through
 * the *sender's* client, and `push_subscriptions` RLS shows each person only
 * their own tokens — so the fan-out could see the sender's devices and nobody
 * else's. And native senders never called it at all, because it only accepted a
 * session cookie.
 *
 * Authorization is now explicit rather than implied by what the caller's client
 * happens to be able to read: the message must exist, the caller must be its
 * sender, and it must belong to the channel they name. Recipients are resolved
 * by the service role, expanding managed players to their guardians and applying
 * each receiving adult's own chat preference (D2).
 */
import { NextResponse } from "next/server";
import { adminClient, resolveRequestUser } from "@/lib/api-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { chatNotificationLimiter, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await chatNotificationLimiter.limit(user.id);
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

  const db = adminClient();

  const { data: message } = await db
    .from("messages")
    .select("id, body, sender_id, channel_id, dm_channel_id, profiles!sender_id(first_name, last_name)")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Only the sender announces their own message, and only in the channel it was
  // actually posted to.
  const belongsHere = channelId
    ? message.channel_id === channelId
    : message.dm_channel_id === dmChannelId;
  if (message.sender_id !== user.id || !belongsHere) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sender = message.profiles as unknown as { first_name: string; last_name: string } | null;
  const senderName = sender
    ? [sender.first_name, sender.last_name].filter(Boolean).join(" ")
    : "Someone";

  let recipientProfileIds: string[] = [];
  let channelLabel = "Team Chat";
  let teamId: string | null = null;

  if (channelId) {
    const { data: channel } = await db
      .from("channels")
      .select("type, name, team_id")
      .eq("id", channelId)
      .maybeSingle();

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    channelLabel = channel.name;
    teamId = channel.team_id;

    if (channel.type === "team") {
      const { data: members } = await db
        .from("team_members")
        .select("profile_id")
        .eq("team_id", channel.team_id);
      recipientProfileIds = (members ?? [])
        .map((m) => m.profile_id)
        .filter((id): id is string => id !== null);
    } else {
      const { data: members } = await db
        .from("channel_members")
        .select("profile_id")
        .eq("channel_id", channelId);
      recipientProfileIds = (members ?? []).map((m) => m.profile_id);
    }
  } else if (dmChannelId) {
    const { data: dm } = await db
      .from("dm_channels")
      .select("profile_a, profile_b, team_id")
      .eq("id", dmChannelId)
      .maybeSingle();

    if (!dm) {
      return NextResponse.json({ error: "DM channel not found" }, { status: 404 });
    }

    recipientProfileIds = [dm.profile_a === user.id ? dm.profile_b : dm.profile_a];
    channelLabel = senderName;
    teamId = dm.team_id;
  }

  // Nobody is told about their own message; a guardian who sent it is dropped by
  // the same rule inside the resolver.
  recipientProfileIds = recipientProfileIds.filter((id) => id !== user.id);

  if (recipientProfileIds.length === 0 || !teamId) {
    return NextResponse.json({ success: true, queued: false });
  }

  const preview = message.body.length > 100 ? `${message.body.slice(0, 97)}…` : message.body;

  // One job per message: announcing the same message twice is a no-op rather
  // than a second buzz on everyone's phone.
  const { error: queueError } = await db.from("notification_jobs").insert({
    team_id: teamId,
    kind: "chat",
    action: "message",
    event_id: null,
    recipient_profile_ids: recipientProfileIds,
    batch_key: `chat:${messageId}`,
    created_by: user.id,
    snapshot: {
      title: channelId ? `${senderName} in ${channelLabel}` : senderName,
      body: preview,
      url: "/dashboard/chat",
    },
  });

  if (queueError && !queueError.message.includes("duplicate key")) {
    console.error("Could not queue chat notification:", queueError);
    return NextResponse.json({ error: "Could not queue notification" }, { status: 500 });
  }

  try {
    await drainNotificationJobs();
  } catch (err) {
    // The job is durable; the daily sweep will pick it up.
    console.error("Chat notification drain failed:", err);
  }

  return NextResponse.json({ success: true, queued: true });
}
