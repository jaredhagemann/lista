"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MessageItem, type MessageWithProfile } from "./message-item";
import { MessageInput } from "./message-input";
import type { Database } from "@/types/database";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type DmChannel = Database["public"]["Tables"]["dm_channels"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function MessageThread({
  initialMessages,
  channel,
  dmChannel,
  currentUserId,
  currentUserProfile,
  isAdmin,
}: {
  initialMessages: MessageWithProfile[];
  channel?: Channel;
  dmChannel?: DmChannel;
  currentUserId: string;
  currentUserProfile: Profile | null;
  isAdmin: boolean;
}) {
  const [messages, setMessages] = useState<MessageWithProfile[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const channelId = channel?.id;
  const dmChannelId = dmChannel?.id;

  // Fetch messages on mount (handles channel switches where initialMessages is empty)
  useEffect(() => {
    if (initialMessages.length > 0) return; // already have messages from SSR
    const query = channelId
      ? supabase.from("messages").select("*, profiles!sender_id(*)").eq("channel_id", channelId)
      : supabase.from("messages").select("*, profiles!sender_id(*)").eq("dm_channel_id", dmChannelId!);
    query.order("created_at", { ascending: true }).limit(50).then(({ data }) => {
      if (data) setMessages(data as MessageWithProfile[]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark channel as read on open
  useEffect(() => {
    if (!channelId) return;
    supabase
      .from("channel_members")
      .upsert(
        { channel_id: channelId, profile_id: currentUserId, last_read_at: new Date().toISOString() },
        { onConflict: "channel_id,profile_id" }
      )
      .then(() => {});
  }, [channelId, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dmChannelId) return;
    const isProfileA = dmChannel!.profile_a === currentUserId;
    const field = isProfileA ? "last_read_a" : "last_read_b";
    supabase
      .from("dm_channels")
      .update({ [field]: new Date().toISOString() })
      .eq("id", dmChannelId)
      .then(() => {});
  }, [dmChannelId, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription
  useEffect(() => {
    const filter = channelId
      ? `channel_id=eq.${channelId}`
      : `dm_channel_id=eq.${dmChannelId}`;

    const realtimeChannel = supabase
      .channel(`messages:${channelId ?? dmChannelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter },
        async (payload) => {
          // Skip messages we already added optimistically
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return prev; // will be replaced after profile fetch below
          });

          // Fetch full message with profile and upsert into state
          const { data } = await supabase
            .from("messages")
            .select("*, profiles!sender_id(*)")
            .eq("id", payload.new.id)
            .single();
          if (data) {
            setMessages((prev) => {
              // Replace optimistic entry if present, otherwise append
              if (prev.some((m) => m.id === data.id)) {
                return prev.map((m) => (m.id === data.id ? (data as MessageWithProfile) : m));
              }
              return [...prev, data as MessageWithProfile];
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id ? { ...m, ...(payload.new as MessageWithProfile) } : m
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [channelId, dmChannelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Optimistic send: called by MessageInput immediately after a successful DB insert
  const handleOptimisticSend = useCallback(
    (messageId: string, body: string) => {
      const optimistic: MessageWithProfile = {
        id: messageId,
        channel_id: channelId ?? null,
        dm_channel_id: dmChannelId ?? null,
        sender_id: currentUserId,
        body,
        created_at: new Date().toISOString(),
        deleted_at: null,
        profiles: currentUserProfile,
      };
      setMessages((prev) => [...prev, optimistic]);
    },
    [channelId, dmChannelId, currentUserId, currentUserProfile]
  );

  const threadTitle = channel?.name ?? "Direct Message";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{threadTitle}</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === currentUserId}
            isAdmin={isAdmin}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        channelId={channelId}
        dmChannelId={dmChannelId}
        senderId={currentUserId}
        onOptimisticSend={handleOptimisticSend}
      />
    </div>
  );
}
