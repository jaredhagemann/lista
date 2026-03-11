import { useEffect, useState } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useSession } from "../../_layout";
import { useActiveMembership } from "../../../hooks/useActiveMembership";

type AvailabilityStatus = "available" | "maybe" | "unavailable";

type Event = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  is_cancelled: boolean;
  locations: { name: string } | null;
};

type Section = {
  title: string;
  data: Event[];
};

function formatDateHeader(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventTypeBadge(type: string) {
  switch (type) {
    case "game":
      return { bg: "#dbeafe", text: "#1d4ed8" };
    case "practice":
      return { bg: "#dcfce7", text: "#15803d" };
    default:
      return { bg: "#f3f4f6", text: "#6b7280" };
  }
}

const RSVP_STYLE: Record<
  AvailabilityStatus,
  { bg: string; border: string; text: string; label: string }
> = {
  available:   { bg: "#dcfce7", border: "#16a34a", text: "#15803d", label: "✓" },
  maybe:       { bg: "#fef3c7", border: "#d97706", text: "#b45309", label: "?" },
  unavailable: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c", label: "✗" },
};

function RsvpBadge({ status }: { status: AvailabilityStatus }) {
  const s = RSVP_STYLE[status];
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: s.border,
        backgroundColor: s.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: s.text, fontSize: 12, fontWeight: "700", lineHeight: 16 }}>
        {s.label}
      </Text>
    </View>
  );
}

function groupByDate(events: Event[]): Section[] {
  const map = new Map<string, Event[]>();
  for (const event of events) {
    const key = event.start_time.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }
  return Array.from(map.entries()).map(([dateKey, data]) => ({
    title: formatDateHeader(dateKey + "T12:00:00"),
    data,
  }));
}

export default function ScheduleScreen() {
  const session = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const membership = useActiveMembership(session?.user.id);

  const [sections, setSections] = useState<Section[]>([]);
  const [myAvailability, setMyAvailability] = useState<
    Map<string, AvailabilityStatus>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin =
    membership?.role === "coach" || membership?.role === "manager";

  useEffect(() => {
    navigation.setOptions({
      title: "Schedule",
      headerRight: isAdmin
        ? () => (
            <TouchableOpacity onPress={() => {}} style={{ marginRight: 4 }}>
              <Ionicons name="add" size={26} color="#0f172a" />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [isAdmin]);

  async function fetchEvents() {
    if (!membership?.teamId || !membership?.profileId) return;

    const [eventsResult, availResult] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, title, event_type, start_time, end_time, is_cancelled, locations(name)"
        )
        .eq("team_id", membership.teamId)
        .order("start_time", { ascending: true }),
      supabase
        .from("availability")
        .select("event_id, status")
        .eq("profile_id", membership.profileId),
    ]);

    setSections(groupByDate((eventsResult.data ?? []) as unknown as Event[]));

    const statusMap = new Map<string, AvailabilityStatus>();
    for (const row of availResult.data ?? []) {
      if (row.event_id) {
        statusMap.set(row.event_id, row.status as AvailabilityStatus);
      }
    }
    setMyAvailability(statusMap);

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (membership === undefined) return;
    fetchEvents();
  }, [membership]);

  function onRefresh() {
    setRefreshing(true);
    fetchEvents();
  }

  if (membership === undefined || loading) {
    return (
      <SafeAreaView
        className="flex-1 bg-white justify-center items-center"
        edges={["bottom"]}
      >
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (sections.length === 0) {
    return (
      <SafeAreaView
        className="flex-1 bg-white justify-center items-center px-6"
        edges={["bottom"]}
      >
        <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
        <Text className="text-gray-400 text-base mt-3 text-center">
          No events scheduled yet.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingVertical: 8 }}
        stickySectionHeadersEnabled={true}
        renderSectionHeader={({ section }) => (
          <View className="bg-gray-50 px-4 py-2 border-b border-gray-100">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const badge = eventTypeBadge(item.event_type);
          const rsvpStatus = myAvailability.get(item.id) ?? null;
          return (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/schedule/${item.id}` as any)}
              className="bg-white mx-3 my-1.5 rounded-xl border border-gray-100 px-4 py-3"
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1 mr-2">
                  <Text
                    className={`font-semibold text-base ${item.is_cancelled ? "line-through text-gray-400" : "text-gray-900"}`}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text className="text-sm text-gray-500 mt-0.5">
                    {formatTime(item.start_time)} – {formatTime(item.end_time)}
                  </Text>
                  {item.locations?.name ? (
                    <View className="flex-row items-center mt-0.5">
                      <Ionicons
                        name="location-outline"
                        size={12}
                        color="#9ca3af"
                      />
                      <Text className="text-sm text-gray-400 ml-0.5">
                        {item.locations.name}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Right column: type pill + RSVP indicator */}
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <View
                    style={{
                      backgroundColor: badge.bg,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 99,
                    }}
                  >
                    <Text
                      style={{ color: badge.text, fontSize: 11 }}
                      className="font-medium capitalize"
                    >
                      {item.event_type}
                    </Text>
                  </View>

                  {item.is_cancelled ? (
                    <View
                      style={{
                        backgroundColor: "#fee2e2",
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 99,
                      }}
                    >
                      <Text style={{ color: "#dc2626", fontSize: 11 }}>
                        Cancelled
                      </Text>
                    </View>
                  ) : rsvpStatus ? (
                    <RsvpBadge status={rsvpStatus} />
                  ) : (
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        borderWidth: 1.5,
                        borderColor: "#d1d5db",
                        borderStyle: "dashed",
                      }}
                    />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}
