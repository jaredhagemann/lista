import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAppContext } from "../../contexts/AppContext";

type Event = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  locations: { name: string } | null;
};

function formatEventTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventTypeBadgeClass(type: string) {
  switch (type) {
    case "game":
      return { bg: "#dcfce7", text: "#15803d" };
    case "practice":
      return { bg: "#dbeafe", text: "#1d4ed8" };
    default:
      return { bg: "#f3e8ff", text: "#7e22ce" };
  }
}

export default function HomeScreen() {
  const router = useRouter();
  const { membership, loading: membershipLoading, refresh } = useAppContext();

  const [events, setEvents] = useState<Event[]>([]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    if (!membership?.teamId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const [eventsResult, countResult] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, event_type, start_time, locations(name)")
        .eq("team_id", membership.teamId)
        .eq("is_cancelled", false)
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(5),
      supabase
        .from("team_members")
        .select("*", { count: "exact", head: true })
        .eq("team_id", membership.teamId),
    ]);

    setEvents((eventsResult.data ?? []) as unknown as Event[]);
    setMemberCount(countResult.count ?? 0);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (membershipLoading) return;
    setLoading(true);
    fetchData();
  }, [membership?.teamId, membership?.profileId, membershipLoading]);

  function onRefresh() {
    setRefreshing(true);
    refresh().then(() => fetchData());
  }

  if (membershipLoading || loading) {
    return (
      <SafeAreaView
        className="flex-1 bg-white justify-center items-center"
        edges={["bottom"]}
      >
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (!membership) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
        <View className="flex-1 justify-center items-center px-6">
          <Ionicons name="people-outline" size={48} color="#9ca3af" />
          <Text className="text-xl font-bold text-gray-900 mt-4 mb-2 text-center">
            Welcome to Lista
          </Text>
          <Text className="text-gray-500 text-center mb-6">
            Create a team to get started, or ask your coach for an invite link.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/(app)/create-team")}
            style={{
              backgroundColor: "#0f172a",
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 10,
              marginBottom: 16,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "600", fontSize: 16 }}>
              Create a team
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "I have an invite link",
                "Ask your coach to share the invite link with you. Tap it on your device to join."
              )
            }
          >
            <Text style={{ color: "#6b7280", fontSize: 15 }}>
              I have an invite link
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isAdmin = membership.role === "coach" || membership.role === "manager";

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 24 }}
      >
        {/* Header */}
        <View className="mb-6">
          <Text className="text-2xl font-bold text-gray-900">
            {membership.teamName}
          </Text>
          {membership.season ? (
            <Text className="text-gray-500 mt-0.5">{membership.season}</Text>
          ) : null}
        </View>

        {/* Upcoming Events */}
        <View className="bg-white rounded-2xl border border-gray-100 mb-4 overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
            <Text className="font-semibold text-gray-900">Upcoming Events</Text>
            <Ionicons name="calendar-outline" size={18} color="#9ca3af" />
          </View>

          {events.length === 0 ? (
            <View className="px-4 py-4">
              <Text className="text-gray-400 text-sm">
                No upcoming events.
                {isAdmin ? " Create one in Schedule." : ""}
              </Text>
            </View>
          ) : (
            <>
              {events.map((event, i) => {
                const badge = eventTypeBadgeClass(event.event_type);
                return (
                  <TouchableOpacity
                    key={event.id}
                    onPress={() =>
                      router.push(`/(app)/schedule/${event.id}` as any)
                    }
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderBottomWidth: i < events.length - 1 ? 1 : 0,
                      borderBottomColor: "#f9fafb",
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text
                        className="font-medium text-gray-900 flex-1 mr-2"
                        numberOfLines={1}
                      >
                        {event.title}
                      </Text>
                      <View
                        style={{
                          backgroundColor: badge.bg,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 99,
                        }}
                      >
                        <Text
                          style={{ color: badge.text, fontSize: 12 }}
                          className="font-medium capitalize"
                        >
                          {event.event_type}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-sm text-gray-500 mt-0.5">
                      {formatEventTime(event.start_time)}
                    </Text>
                    {event.locations?.name ? (
                      <Text className="text-sm text-gray-400">
                        {event.locations.name}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => router.push("/(app)/schedule" as any)}
                className="px-4 py-3 border-t border-gray-50"
              >
                <Text className="text-sm text-blue-600 text-center">
                  View full schedule
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Team */}
        <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
            <Text className="font-semibold text-gray-900">Team</Text>
            <Ionicons name="people-outline" size={18} color="#9ca3af" />
          </View>
          <View className="px-4 py-4">
            <Text className="text-3xl font-bold text-gray-900">
              {memberCount ?? "—"}
            </Text>
            <Text className="text-sm text-gray-500 mb-2">team members</Text>
            <TouchableOpacity onPress={() => router.push("/(app)/team" as any)}>
              <Text className="text-sm text-blue-600">View roster</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
