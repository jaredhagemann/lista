import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/get-active-membership";
import { ChatLayout } from "@/components/chat/chat-layout";
import type { Database } from "@/types/database";
import type { DmChannelWithProfile } from "@/components/chat/channel-list";
import type { MessageWithProfile } from "@/components/chat/message-item";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type DmChannel = Database["public"]["Tables"]["dm_channels"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
};

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/dashboard");

  const teamId = membership.team_id!;
  const isAdmin = membership.role === "coach" || membership.role === "manager";

  // The auth user always sends as themselves (Option A)
  const currentUserId = user.id;

  // Fetch the current user's own profile (needed for optimistic message rendering)
  const { data: rawCurrentProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUserId)
    .single();
  const currentUserProfile = rawCurrentProfile as Profile | null;

  // ── Fetch team channel ──────────────────────────────────────────────────
  const { data: rawTeamChannel } = await supabase
    .from("channels")
    .select("*")
    .eq("team_id", teamId)
    .eq("type", "team")
    .maybeSingle();
  const teamChannel = rawTeamChannel as Channel | null;

  // ── Unread count for team channel ───────────────────────────────────────
  let teamChannelUnread = 0;
  if (teamChannel) {
    const { data: readRow } = await supabase
      .from("channel_members")
      .select("last_read_at")
      .eq("channel_id", teamChannel.id)
      .eq("profile_id", currentUserId)
      .maybeSingle();

    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", teamChannel.id)
      .is("deleted_at", null)
      .neq("sender_id", currentUserId)
      .gt("created_at", readRow?.last_read_at ?? "1970-01-01");

    teamChannelUnread = count ?? 0;
  }

  // ── Fetch group channels the user is a member of ────────────────────────
  const { data: rawMemberRows } = await supabase
    .from("channel_members")
    .select("channel_id, last_read_at, channels!inner(*)")
    .eq("profile_id", currentUserId);

  const groupChannelRows = (rawMemberRows ?? []).filter(
    (row) => (row.channels as unknown as Channel).type === "group"
  );

  // For each group channel, compute unread count
  const groupChannels = await Promise.all(
    groupChannelRows.map(async (row) => {
      const ch = row.channels as unknown as Channel;
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", ch.id)
        .is("deleted_at", null)
        .neq("sender_id", currentUserId)
        .gt("created_at", row.last_read_at ?? "1970-01-01");
      return { ...ch, unreadCount: count ?? 0 };
    })
  );

  // ── Fetch DM channels ───────────────────────────────────────────────────
  const { data: rawDmChannels } = await supabase
    .from("dm_channels")
    .select("*")
    .eq("team_id", teamId)
    .or(`profile_a.eq.${currentUserId},profile_b.eq.${currentUserId}`);

  const dmChannelRows = (rawDmChannels ?? []) as DmChannel[];

  // Resolve the other party's profile for each DM
  const otherProfileIds = dmChannelRows.map((dm) =>
    dm.profile_a === currentUserId ? dm.profile_b : dm.profile_a
  );

  let otherProfiles: Profile[] = [];
  if (otherProfileIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .in("id", otherProfileIds);
    otherProfiles = (data ?? []) as Profile[];
  }
  const profileMap = new Map(otherProfiles.map((p) => [p.id, p]));

  const dmChannels: DmChannelWithProfile[] = await Promise.all(
    dmChannelRows.map(async (dm) => {
      const otherId = dm.profile_a === currentUserId ? dm.profile_b : dm.profile_a;
      const otherProfile = profileMap.get(otherId)!;
      const lastReadAt = dm.profile_a === currentUserId ? dm.last_read_a : dm.last_read_b;
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("dm_channel_id", dm.id)
        .is("deleted_at", null)
        .neq("sender_id", currentUserId)
        .gt("created_at", lastReadAt ?? "1970-01-01");
      return { ...dm, otherProfile, unreadCount: count ?? 0 };
    })
  );

  // ── Fetch all team members for DM/group member pickers ──────────────────
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("*, profiles(*)")
    .eq("team_id", teamId)
    .order("created_at");
  const teamMembers = (rawMembers ?? []) as TeamMemberWithProfile[];

  // ── Fetch initial messages for team channel (last 50) ───────────────────
  let initialMessages: MessageWithProfile[] = [];
  if (teamChannel) {
    const { data } = await supabase
      .from("messages")
      .select("*, profiles!sender_id(*)")
      .eq("channel_id", teamChannel.id)
      .order("created_at", { ascending: true })
      .limit(50);
    initialMessages = (data ?? []) as MessageWithProfile[];
  }

  return (
    <ChatLayout
      teamChannel={teamChannel}
      teamChannelUnread={teamChannelUnread}
      groupChannels={groupChannels}
      dmChannels={dmChannels}
      teamMembers={teamMembers}
      initialMessages={initialMessages}
      teamId={teamId}
      currentUserId={currentUserId}
      currentUserProfile={currentUserProfile}
      isAdmin={isAdmin}
    />
  );
}
