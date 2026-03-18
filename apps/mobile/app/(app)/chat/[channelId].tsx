import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { supabase } from "../../../lib/supabase";
import * as Crypto from "expo-crypto";
import { useAppContext } from "../../../contexts/AppContext";
import { useSession } from "../../_layout";
import { MessageItem, type Message } from "../../../components/chat/MessageItem";
import { MessageInput } from "../../../components/chat/MessageInput";
import type { RealtimeChannel } from "@supabase/supabase-js";

export default function ChannelScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const session = useSession();
  const navigation = useNavigation();
  const { membership } = useAppContext();

  const ownId = session?.user.id ?? "";
  const isAdmin = membership?.role === "coach" || membership?.role === "manager";
  const headerHeight = useHeaderHeight();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const realtimeRef = useRef<RealtimeChannel | null>(null);
  const optimisticIds = useRef<Set<string>>(new Set());

  const markRead = useCallback(async () => {
    if (!channelId || !ownId) return;
    await supabase.from("channel_members").upsert(
      { channel_id: channelId, profile_id: ownId, last_read_at: new Date().toISOString() },
      { onConflict: "channel_id,profile_id" }
    );
  }, [channelId, ownId]);

  const fetchMessages = useCallback(async () => {
    if (!channelId) return;
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at, deleted_at, profiles!sender_id(first_name, last_name)")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(50);
    setMessages((data ?? []) as unknown as Message[]);
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;

    // Fetch channel name for header
    supabase
      .from("channels")
      .select("name, type")
      .eq("id", channelId)
      .single()
      .then(({ data }) => {
        navigation.setOptions({
          title: data?.type === "team" ? "Team Chat" : (data?.name ?? "Group"),
        });
      });

    fetchMessages();
    markRead();

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          const msg = payload.new as any;
          if (optimisticIds.current.has(msg.id)) return;
          // Fetch with profile
          const { data } = await supabase
            .from("messages")
            .select("id, sender_id, body, created_at, deleted_at, profiles!sender_id(first_name, last_name)")
            .eq("id", msg.id)
            .single();
          if (data) {
            setMessages((prev) => [data as unknown as Message, ...prev]);
            markRead();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    realtimeRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  async function handleSend(text: string) {
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const optimistic: Message = {
      id,
      sender_id: ownId,
      body: text,
      created_at: now,
      deleted_at: null,
      profiles: null,
    };
    optimisticIds.current.add(id);
    setMessages((prev) => [optimistic, ...prev]);

    const { error } = await supabase.from("messages").insert({
      id,
      channel_id: channelId,
      sender_id: ownId,
      body: text,
    });

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      optimisticIds.current.delete(id);
    }
  }

  async function handleDelete(id: string) {
    await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const showSender = !prev || prev.sender_id !== item.sender_id;
            const canDelete = item.sender_id === ownId || isAdmin;
            return (
              <MessageItem
                message={item}
                isOwn={item.sender_id === ownId}
                showSender={showSender}
                canDelete={canDelete}
                onDelete={handleDelete}
              />
            );
          }}
        />
        <MessageInput onSend={handleSend} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  flex: { flex: 1 },
  listContent: { paddingVertical: 8 },
});
