import { useEffect, useState, useRef, useCallback } from "react";
import { useFocusEffect } from "expo-router";
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
import { eventZone, formatEventClock, formatEventDay } from "../../../lib/event-time";
import { useAppContext } from "../../../contexts/AppContext";
import { displayLabel } from "../../../lib/labels";
import { gameTitle } from "../../../lib/game-display";
import { gameCount, isTournament, isUnderway, tournamentDates, tournamentLine } from "../../../lib/tournament";
import { effectiveAnswer } from "../../../lib/availability";

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailabilityStatus = "available" | "maybe" | "unavailable";

type Event = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  is_cancelled: boolean;
  timezone: string | null;
  opponent: string | null;
  home_away: string | null;
  score_for: number | null;
  score_against: number | null;
  /** The event's own team: its zone, and its name for game titles. */
  teams: { timezone: string | null; name: string } | null;
  locations: { name: string } | null;
  /** A game's tournament, for "Surf Cup · Semifinal", and its round. */
  tournament_id: string | null;
  round: string | null;
  tournament: { title: string } | null;
  /** A tournament's game count. */
  games: { count: number }[] | null;
};

type ListItem =
  | { type: "event"; event: Event }
  | { type: "today-divider" };

// ── Helpers ───────────────────────────────────────────────────────────────────


function eventTypeBadge(type: string) {
  switch (type) {
    case "game":     return { bg: "#dcfce7", text: "#15803d" };
    case "practice": return { bg: "#dbeafe", text: "#1d4ed8" };
    case "tournament": return { bg: "#fef3c7", text: "#92400e" };
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

/**
 * Your answer. On a tournament's game it may be the tournament's, which the
 * game follows until you answer it (spec §4, Availability): dashed and faded.
 */
function RsvpBadge({ status, inherited, label }: { status: AvailabilityStatus; inherited: boolean; label: string }) {
  const s = RSVP_STYLE[status];
  const words = { available: "Available", maybe: "Maybe", unavailable: "Unavailable" }[status];
  return (
    <View
      accessible
      accessibilityLabel={`Your answer for ${label}: ${words}${inherited ? ", from the tournament" : ""}`}
      style={[
        styles.rsvpCircle,
        { borderColor: s.border, backgroundColor: s.bg },
        inherited && { borderStyle: "dashed", opacity: 0.6 },
      ]}
    >
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
    // A tournament underway belongs to today: it started days ago, but it's on.
    const underway = isTournament(event) && isUnderway(event);
    const eventDay = underway ? today : startOfDay(new Date(event.start_time));

    // Insert "Today" divider before the first event on or after today
    if (!dividerInserted && eventDay >= today) {
      items.push({ type: "today-divider" });
      dividerInserted = true;
    }

    // Track the first non-cancelled upcoming event for auto-scroll
    if (
      firstUpcomingIndex === -1 &&
      !event.is_cancelled &&
      (underway || new Date(event.start_time) >= new Date())
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
    if (!membership?.teamId || !membership?.profileId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const [eventsResult, availResult] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, title, event_type, start_time, end_time, is_cancelled, timezone, opponent, home_away, score_for, score_against, tournament_id, round, teams(timezone, name), locations(name), tournament:tournament_id(title), games:events!tournament_id(count)"
        )
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

  useFocusEffect(
    useCallback(() => {
      if (membershipLoading) return;
      fetchEvents();
    }, [fetchEvents, membershipLoading])
  );

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

  if (!membership) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>No team yet</Text>
        <Text style={[styles.emptyText, { fontSize: 13, marginTop: 4 }]}>
          Create a team or ask your coach for an invite link to get started.
        </Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push("/(app)/create-team")}
        >
          <Text style={styles.createButtonText}>Create a team</Text>
        </TouchableOpacity>
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
          // A game's own answer, else its tournament's (spec §4, Availability).
          const rsvp = effectiveAnswer(
            myAvailability.get(event.id),
            event.tournament_id ? myAvailability.get(event.tournament_id) : null
          );
          const title = gameTitle(event, event.teams?.name);
          // A tournament spans whole days: its dates and games, never times (D13).
          const tournament = isTournament(event);
          const games = event.games?.[0]?.count ?? 0;
          const partOf = tournamentLine(event);

          return (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/schedule/${event.id}` as any)}
              accessibilityLabel={tournament ? `${event.title}, tournament` : undefined}
              style={styles.card}
            >
              {/* Date header inside card */}
              <View style={styles.dateRow}>
                <Text style={styles.cardDate}>
                  {tournament ? tournamentDates(event) : formatEventDay(event.start_time, eventZone(event))}
                </Text>
                {tournament && !event.is_cancelled && isUnderway(event) ? (
                  <View style={styles.nowPill}>
                    <Text style={styles.nowPillText}>Now</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.cardBody}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text
                    style={[
                      styles.cardTitle,
                      event.is_cancelled && styles.cardTitleCancelled,
                    ]}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                  {partOf ? <Text style={styles.partOf}>{partOf}</Text> : null}
                  {tournament ? (
                    games > 0 ? <Text style={styles.cardTime}>{gameCount(games)}</Text> : null
                  ) : (
                    <Text style={styles.cardTime}>
                      {formatEventClock(event.start_time, eventZone(event))} – {formatEventClock(event.end_time, eventZone(event))}
                    </Text>
                  )}
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
                      {displayLabel(event.event_type)}
                    </Text>
                  </View>

                  {event.is_cancelled ? (
                    <View style={styles.cancelledPill}>
                      <Text style={styles.cancelledPillText}>Cancelled</Text>
                    </View>
                  ) : rsvp.status ? (
                    <RsvpBadge status={rsvp.status} inherited={rsvp.inherited} label={title} />
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
  emptyText: { color: "#9ca3af", fontSize: 15, textAlign: "center", paddingHorizontal: 32 },
  createButton: {
    marginTop: 16,
    backgroundColor: "#0f172a",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  createButtonText: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
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
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  cardDate: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nowPill: { backgroundColor: "#0f172a", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99 },
  nowPillText: { color: "#ffffff", fontSize: 10, fontWeight: "700" },
  partOf: { fontSize: 12, color: "#92400e", marginTop: 1 },
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
  typePillText: { fontSize: 11, fontWeight: "600" },
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
