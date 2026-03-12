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
import { useLocalSearchParams, useNavigation } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import { useSession } from "../../../_layout";
import { MessageItem, type Message } from "../../../../components/chat/MessageItem";
import { MessageInput } from "../../../../components/chat/MessageInput";
import type { RealtimeChannel } from "@supabase/supabase-js";

export default function DmScreen() {
  const { dmId } = useLocalSearchParams<{ dmId: string }>();
  const session = useSession();
  const navigation = useNavigation();

  const ownId = session?.user.id ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProfileA, setIsProfileA] = useState(false);
  const realtimeRef = useRef<RealtimeChannel | null>(null);
  const optimisticIds = useRef<Set<string>>(new Set());

  const markRead = useCallback(async () => {
    if (!dmId) return;
    const field = isProfileA ? "last_read_a" : "last_read_b";
    await supabase
      .from("dm_channels")
      .update({ [field]: new Date().toISOString() })
      .eq("id", dmId);
  }, [dmId, isProfileA]);

  useEffect(() => {
    if (!dmId || !ownId) return;

    // Fetch DM channel to get other profile's name and determine position
    supabase
      .from("dm_channels")
      .select("profile_a, profile_b")
      .eq("id", dmId)
      .single()
      .then(async ({ data }) => {
        if (!data) return;
        const profileA = data.profile_a === ownId;
        setIsProfileA(profileA);
        const otherId = profileA ? data.profile_b : data.profile_a;
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", otherId)
          .single();
        if (profile) {
          navigation.setOptions({
            title: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
          });
        }
      });

    // Fetch messages
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at, deleted_at, profiles!sender_id(first_name, last_name)")
      .eq("dm_channel_id", dmId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setMessages((data ?? []) as unknown as Message[]);
        setLoading(false);
      });

    markRead();

    // Realtime
    const channel = supabase
      .channel(`dm:${dmId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `dm_channel_id=eq.${dmId}`,
        },
        async (payload) => {
          const msg = payload.new as any;
          if (optimisticIds.current.has(msg.id)) return;
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
          filter: `dm_channel_id=eq.${dmId}`,
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
  }, [dmId, ownId]);

  async function handleSend(text: string) {
    const id = crypto.randomUUID();
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
      dm_channel_id: dmId,
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
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const showSender = !prev || prev.sender_id !== item.sender_id;
            return (
              <MessageItem
                message={item}
                isOwn={item.sender_id === ownId}
                showSender={showSender}
                canDelete={item.sender_id === ownId}
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
