import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { arrivalInstant, eventZone, formatEventClock, formatEventDateTime } from "../../../lib/event-time";
import { useAppContext } from "../../../contexts/AppContext";
import { displayLabel } from "../../../lib/labels";
import { gameTitle, homeAwayLabel, scoreLine, uniformOf, type TeamUniforms } from "../../../lib/game-display";
import { UniformLabel } from "../../../components/UniformLabel";

type AvailabilityStatus = "available" | "maybe" | "unavailable";

type EventDetail = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  is_cancelled: boolean;
  notes: string | null;
  /** Minutes before the start. */
  arrival_time: number | null;
  timezone: string | null;
  opponent: string | null;
  home_away: string | null;
  uniform: string | null;
  score_for: number | null;
  score_against: number | null;
  game_result: string | null;
  /** The event's own team: its zone, name and uniforms. */
  teams: ({ timezone: string | null; name: string } & TeamUniforms) | null;
  locations: { name: string; address: string | null } | null;
};

const RESULT_STYLE: Record<string, { bg: string; text: string }> = {
  win: { bg: "#dcfce7", text: "#15803d" },
  loss: { bg: "#fee2e2", text: "#b91c1c" },
  tie: { bg: "#f3f4f6", text: "#374151" },
};

/**
 * Opponent, home or away, uniform and result, as on the web's event page.
 * Nothing for a game with none of them, or for any other event.
 */
function GameDetails({ event }: { event: EventDetail }) {
  const uniform = uniformOf(event.uniform, event.teams);
  if (event.event_type !== "game" || !(event.opponent || event.home_away || uniform || event.game_result)) {
    return null;
  }
  const result = event.game_result ? RESULT_STYLE[event.game_result] ?? RESULT_STYLE.tie : null;
  const score = scoreLine(event);
  return (
    <View
      accessibilityLabel="Game details"
      className="bg-white rounded-2xl border border-gray-100 px-4 py-4 gap-2"
    >
      <Text className="font-semibold text-gray-900 mb-1">Game details</Text>
      {event.opponent ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400">Opponent</Text>
          <Text className="text-sm text-gray-700">{event.opponent}</Text>
        </View>
      ) : null}
      {event.home_away ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400">Playing</Text>
          <Text className="text-sm text-gray-700">{homeAwayLabel(event.home_away)}</Text>
        </View>
      ) : null}
      {uniform ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400">Uniform</Text>
          <UniformLabel uniform={uniform} />
        </View>
      ) : null}
      {result && event.game_result ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-gray-400">Result</Text>
          <View style={{ backgroundColor: result.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 }}>
            <Text style={{ color: result.text, fontSize: 12, fontWeight: "600" }}>
              {displayLabel(event.game_result)}
            </Text>
          </View>
          {score ? <Text className="text-sm text-gray-700">{score}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

type AvailabilityRow = {
  profile_id: string;
  status: AvailabilityStatus;
  profiles: { first_name: string; last_name: string } | null;
};

type TeamMemberRow = {
  profile_id: string;
  profiles: { first_name: string; last_name: string } | null;
};


function RsvpButton({
  label,
  icon,
  status,
  current,
  activeColor,
  onPress,
  disabled,
}: {
  label: string;
  icon: string;
  status: AvailabilityStatus;
  current: AvailabilityStatus | null;
  activeColor: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const isActive = current === status;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: isActive ? activeColor : "#e5e7eb",
        backgroundColor: isActive ? activeColor : "#ffffff",
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 16, marginBottom: 2 }}>{icon}</Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: isActive ? "#ffffff" : "#6b7280",
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const navigation = useNavigation();
  const { membership } = useAppContext();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [myStatus, setMyStatus] = useState<AvailabilityStatus | null>(null);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    if (!eventId || !membership?.profileId) return;

    const [eventResult, availResult, membersResult] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, title, event_type, start_time, end_time, is_cancelled, notes, arrival_time, timezone, opponent, home_away, uniform, score_for, score_against, game_result, teams(timezone, name, home_uniform, away_uniform, home_uniform_color, away_uniform_color), locations(name, address)"
        )
        .eq("id", eventId)
        .single(),
      supabase
        .from("availability")
        .select("profile_id, status, profiles(first_name, last_name)")
        .eq("event_id", eventId),
      supabase
        .from("team_members")
        .select("profile_id, profiles(first_name, last_name)")
        .eq("team_id", membership.teamId),
    ]);

    if (eventResult.data) {
      const detail = eventResult.data as unknown as EventDetail;
      setEvent(detail);
      navigation.setOptions({ title: gameTitle(detail, detail.teams?.name) });
    }

    const rows = (availResult.data ?? []) as unknown as AvailabilityRow[];
    setAvailability(rows);
    setTeamMembers((membersResult.data ?? []) as unknown as TeamMemberRow[]);
    const mine = rows.find((r) => r.profile_id === membership.profileId);
    setMyStatus(mine?.status ?? null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!membership) return;
    fetchData();
  }, [membership?.profileId, membership?.teamId, eventId]);

  function onRefresh() {
    setRefreshing(true);
    fetchData();
  }

  async function handleRsvp(clicked: AvailabilityStatus) {
    if (!membership?.profileId || !eventId) return;
    setRsvpLoading(true);
    const previous = myStatus;

    if (clicked === myStatus) {
      setMyStatus(null);
      const { error } = await supabase
        .from("availability")
        .delete()
        .eq("event_id", eventId)
        .eq("profile_id", membership.profileId);
      if (error) setMyStatus(previous);
    } else {
      setMyStatus(clicked);
      const { error } = await supabase.from("availability").upsert(
        {
          event_id: eventId,
          profile_id: membership.profileId,
          status: clicked,
        },
        { onConflict: "event_id,profile_id" }
      );
      if (error) setMyStatus(previous);
    }

    setRsvpLoading(false);
  }

  if (loading || !membership) {
    return (
      <SafeAreaView
        className="flex-1 bg-white justify-center items-center"
        edges={["bottom"]}
      >
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView
        className="flex-1 bg-white justify-center items-center px-6"
        edges={["bottom"]}
      >
        <Text className="text-gray-500">Event not found.</Text>
      </SafeAreaView>
    );
  }

  const available = availability.filter((r) => r.status === "available");
  const maybe = availability.filter((r) => r.status === "maybe");
  const unavailable = availability.filter((r) => r.status === "unavailable");
  const respondedIds = new Set(availability.map((r) => r.profile_id));
  const noResponse = teamMembers.filter((m) => !respondedIds.has(m.profile_id));

  function memberName(r: { profiles: { first_name: string; last_name: string } | null }) {
    if (!r.profiles) return "Unknown";
    return [r.profiles.first_name, r.profiles.last_name].filter(Boolean).join(" ");
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        {/* Event header */}
        <View className="bg-white rounded-2xl border border-gray-100 px-4 py-4">
          <View className="flex-row items-center gap-2 mb-1">
            <View
              style={{
                backgroundColor:
                  event.event_type === "game" ? "#dcfce7" : event.event_type === "practice" ? "#dbeafe" : "#f3e8ff",
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 99,
              }}
            >
              <Text
                style={{
                  color: event.event_type === "game" ? "#15803d" : event.event_type === "practice" ? "#1d4ed8" : "#7e22ce",
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {displayLabel(event.event_type)}
              </Text>
            </View>
            {event.is_cancelled ? (
              <View
                style={{
                  backgroundColor: "#fee2e2",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 99,
                }}
              >
                <Text style={{ color: "#dc2626", fontSize: 12, fontWeight: "600" }}>
                  Cancelled
                </Text>
              </View>
            ) : null}
          </View>

          <Text
            className={`text-xl font-bold mb-3 ${event.is_cancelled ? "line-through text-gray-400" : "text-gray-900"}`}
          >
            {gameTitle(event, event.teams?.name)}
          </Text>

          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Ionicons name="time-outline" size={16} color="#9ca3af" />
              <Text className="text-sm text-gray-700">
                {formatEventDateTime(event.start_time, eventZone(event))}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Ionicons name="arrow-forward-outline" size={16} color="#9ca3af" />
              <Text className="text-sm text-gray-700">
                Ends {formatEventClock(event.end_time, eventZone(event))}
              </Text>
            </View>
            {event.arrival_time != null ? (
              <View className="flex-row items-center gap-2">
                <Ionicons name="walk-outline" size={16} color="#9ca3af" />
                <Text className="text-sm text-gray-700">
                  Arrive by {formatEventClock(arrivalInstant(event.start_time, event.arrival_time), eventZone(event))}
                </Text>
              </View>
            ) : null}
            {event.locations ? (
              <View className="flex-row items-start gap-2">
                <Ionicons name="location-outline" size={16} color="#9ca3af" style={{ marginTop: 1 }} />
                <View>
                  <Text className="text-sm text-gray-700">
                    {event.locations.name}
                  </Text>
                  {event.locations.address ? (
                    <Text className="text-sm text-gray-400">
                      {event.locations.address}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>

          {event.notes ? (
            <View className="mt-3 pt-3 border-t border-gray-50">
              <Text className="text-sm text-gray-500">{event.notes}</Text>
            </View>
          ) : null}
        </View>

        <GameDetails event={event} />

        {/* RSVP */}
        {!event.is_cancelled ? (
          <View className="bg-white rounded-2xl border border-gray-100 px-4 py-4">
            <Text className="font-semibold text-gray-900 mb-3">
              Your availability
            </Text>
            <View className="flex-row gap-2">
              <RsvpButton
                label="Available"
                icon="✓"
                status="available"
                current={myStatus}
                activeColor="#16a34a"
                onPress={() => handleRsvp("available")}
                disabled={rsvpLoading}
              />
              <RsvpButton
                label="Maybe"
                icon="?"
                status="maybe"
                current={myStatus}
                activeColor="#d97706"
                onPress={() => handleRsvp("maybe")}
                disabled={rsvpLoading}
              />
              <RsvpButton
                label="Can't go"
                icon="✗"
                status="unavailable"
                current={myStatus}
                activeColor="#dc2626"
                onPress={() => handleRsvp("unavailable")}
                disabled={rsvpLoading}
              />
            </View>
            {myStatus ? (
              <Text className="text-xs text-gray-400 text-center mt-2">
                Tap again to clear your response
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Availability summary — always shown */}
        <View className="bg-white rounded-2xl border border-gray-100 px-4 py-4">
          <Text className="font-semibold text-gray-900 mb-3">Responses</Text>

          {available.length > 0 ? (
            <View className="mb-3">
              <Text className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">
                Available ({available.length})
              </Text>
              {available.map((r) => (
                <Text key={r.profile_id} className="text-sm text-gray-700 py-0.5">
                  {memberName(r)}
                </Text>
              ))}
            </View>
          ) : null}

          {maybe.length > 0 ? (
            <View className="mb-3">
              <Text className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                Maybe ({maybe.length})
              </Text>
              {maybe.map((r) => (
                <Text key={r.profile_id} className="text-sm text-gray-700 py-0.5">
                  {memberName(r)}
                </Text>
              ))}
            </View>
          ) : null}

          {unavailable.length > 0 ? (
            <View className="mb-3">
              <Text className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                Unavailable ({unavailable.length})
              </Text>
              {unavailable.map((r) => (
                <Text key={r.profile_id} className="text-sm text-gray-700 py-0.5">
                  {memberName(r)}
                </Text>
              ))}
            </View>
          ) : null}

          {noResponse.length > 0 ? (
            <View>
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                No Response ({noResponse.length})
              </Text>
              {noResponse.map((m) => (
                <Text key={m.profile_id} className="text-sm text-gray-400 py-0.5">
                  {memberName(m)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
