import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type ListItem =
  | { type: "event"; event: Event }
  | { type: "today-divider" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
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
    case "game":     return { bg: "#dcfce7", text: "#15803d" };
    case "practice": return { bg: "#dbeafe", text: "#1d4ed8" };
    default:         return { bg: "#f3e8ff", text: "#7e22ce" };
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
    <View style={[styles.rsvpCircle, { borderColor: s.border, backgroundColor: s.bg }]}>
      <Text style={{ color: s.text, fontSize: 12, fontWeight: "700", lineHeight: 16 }}>
        {s.label}
      </Text>
    </View>
  );
}

/** Midnight local time for a given ISO date string or Date */
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildItems(events: Event[]): { items: ListItem[]; firstUpcomingIndex: number } {
  const today = startOfDay(new Date());
  const items: ListItem[] = [];
  let dividerInserted = false;
  let firstUpcomingIndex = -1;

  for (const event of events) {
    const eventDay = startOfDay(new Date(event.start_time));

    // Insert "Today" divider before the first event on or after today
    if (!dividerInserted && eventDay >= today) {
      items.push({ type: "today-divider" });
      dividerInserted = true;
    }

    // Track the first non-cancelled upcoming event for auto-scroll
    if (
      firstUpcomingIndex === -1 &&
      !event.is_cancelled &&
      new Date(event.start_time) >= new Date()
    ) {
      firstUpcomingIndex = items.length;
    }

    items.push({ type: "event", event });
  }

  // All events are in the past — divider goes at the end
  if (!dividerInserted) {
    items.push({ type: "today-divider" });
  }

  // If the divider itself is the scroll target (no upcoming events found yet),
  // scroll to it so the user sees "Today" at the top
  if (firstUpcomingIndex === -1) {
    const dividerIdx = items.findIndex((i) => i.type === "today-divider");
    firstUpcomingIndex = dividerIdx;
  }

  return { items, firstUpcomingIndex };
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { membership, loading: membershipLoading } = useAppContext();
  const listRef = useRef<FlatList<ListItem>>(null);

  const [items, setItems] = useState<ListItem[]>([]);
  const [firstUpcomingIndex, setFirstUpcomingIndex] = useState(-1);
  const [myAvailability, setMyAvailability] = useState<Map<string, AvailabilityStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = membership?.role === "coach" || membership?.role === "manager";

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

  const fetchEvents = useCallback(async () => {
    if (!membership?.teamId || !membership?.profileId) return;

    const [eventsResult, availResult] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, event_type, start_time, end_time, is_cancelled, locations(name)")
        .eq("team_id", membership.teamId)
        .order("start_time", { ascending: true }),
      supabase
        .from("availability")
        .select("event_id, status")
        .eq("profile_id", membership.profileId),
    ]);

    const events = (eventsResult.data ?? []) as unknown as Event[];
    const { items: newItems, firstUpcomingIndex: idx } = buildItems(events);
    setItems(newItems);
    setFirstUpcomingIndex(idx);

    const statusMap = new Map<string, AvailabilityStatus>();
    for (const row of availResult.data ?? []) {
      if (row.event_id) statusMap.set(row.event_id, row.status as AvailabilityStatus);
    }
    setMyAvailability(statusMap);

    setLoading(false);
    setRefreshing(false);
  }, [membership?.teamId, membership?.profileId]);

  useEffect(() => {
    if (membershipLoading) return;
    fetchEvents();
  }, [fetchEvents, membershipLoading]);

  // Auto-scroll to first upcoming event after the list renders
  useEffect(() => {
    if (firstUpcomingIndex <= 0 || items.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: firstUpcomingIndex,
        animated: false,
        viewPosition: 0,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [firstUpcomingIndex, items.length]);

  function onRefresh() {
    setRefreshing(true);
    fetchEvents();
  }

  if (membershipLoading || loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>No events scheduled yet.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item, index) =>
          item.type === "today-divider" ? "today-divider" : item.event.id
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={(info) => {
          // Fallback if index isn't rendered yet — scroll to approximate offset
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
        }}
        renderItem={({ item }) => {
          if (item.type === "today-divider") {
            return (
              <View style={styles.todayDivider}>
                <View style={styles.todayLine} />
                <Text style={styles.todayLabel}>Today</Text>
                <View style={styles.todayLine} />
              </View>
            );
          }

          const { event } = item;
          const badge = eventTypeBadge(event.event_type);
          const rsvpStatus = myAvailability.get(event.id) ?? null;

          return (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/schedule/${event.id}` as any)}
              style={styles.card}
            >
              {/* Date header inside card */}
              <Text style={styles.cardDate}>{formatDate(event.start_time)}</Text>

              <View style={styles.cardBody}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text
                    style={[
                      styles.cardTitle,
                      event.is_cancelled && styles.cardTitleCancelled,
                    ]}
                    numberOfLines={1}
                  >
                    {event.title}
                  </Text>
                  <Text style={styles.cardTime}>
                    {formatTime(event.start_time)} – {formatTime(event.end_time)}
                  </Text>
                  {event.locations?.name ? (
                    <View style={styles.locationRow}>
                      <Ionicons name="location-outline" size={12} color="#9ca3af" />
                      <Text style={styles.locationText}>{event.locations.name}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Right column: type pill + RSVP */}
                <View style={styles.rightCol}>
                  <View style={[styles.typePill, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.typePillText, { color: badge.text }]}>
                      {event.event_type}
                    </Text>
                  </View>

                  {event.is_cancelled ? (
                    <View style={styles.cancelledPill}>
                      <Text style={styles.cancelledPillText}>Cancelled</Text>
                    </View>
                  ) : rsvpStatus ? (
                    <RsvpBadge status={rsvpStatus} />
                  ) : (
                    <View style={styles.rsvpEmpty} />
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: {
    flex: 1,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  emptyText: { color: "#9ca3af", fontSize: 15 },
  listContent: { paddingVertical: 8 },

  // Today divider
  todayDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 8,
    gap: 8,
  },
  todayLine: { flex: 1, height: 1, backgroundColor: "#0f172a" },
  todayLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // Event card
  card: {
    backgroundColor: "#ffffff",
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  cardDate: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  cardBody: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  cardTitleCancelled: {
    textDecorationLine: "line-through",
    color: "#9ca3af",
  },
  cardTime: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    gap: 2,
  },
  locationText: { fontSize: 12, color: "#9ca3af" },

  rightCol: { alignItems: "flex-end", gap: 6 },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
  },
  typePillText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  cancelledPill: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
  },
  cancelledPillText: { color: "#dc2626", fontSize: 11 },
  rsvpCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpEmpty: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderStyle: "dashed",
  },
});
