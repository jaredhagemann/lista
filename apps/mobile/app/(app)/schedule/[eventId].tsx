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
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { arrivalInstant, eventZone, formatEventClock, formatEventDateTime } from "../../../lib/event-time";
import { useAppContext } from "../../../contexts/AppContext";
import { displayLabel } from "../../../lib/labels";
import { gameTitle, homeAwayLabel, scoreLine, uniformOf, type TeamUniforms } from "../../../lib/game-display";
import { UniformLabel } from "../../../components/UniformLabel";
import {
  answerersFor,
  groupResponses,
  nextAvailability,
  type Answerer,
  type AvailabilityStatus,
  type RosterMember,
} from "../../../lib/availability";

type EventDetail = {
  team_id: string;
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
 * A label and its value. The value takes the rest of the row and may shrink
 * below its content (React Native doesn't shrink by default), so a long name,
 * or large accessibility text, wraps inside the card instead of running off it.
 */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Text className="text-sm text-gray-400">{label}</Text>
      <View style={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>{children}</View>
    </View>
  );
}

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
        <DetailRow label="Opponent">
          <Text className="text-sm text-gray-700">{event.opponent}</Text>
        </DetailRow>
      ) : null}
      {event.home_away ? (
        <DetailRow label="Playing">
          <Text className="text-sm text-gray-700">{homeAwayLabel(event.home_away)}</Text>
        </DetailRow>
      ) : null}
      {uniform ? (
        <DetailRow label="Uniform">
          <UniformLabel uniform={uniform} />
        </DetailRow>
      ) : null}
      {result && event.game_result ? (
        <DetailRow label="Result">
          <View className="flex-row flex-wrap items-center gap-2">
            <View style={{ backgroundColor: result.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 }}>
              <Text style={{ color: result.text, fontSize: 12, fontWeight: "600" }}>
                {displayLabel(event.game_result)}
              </Text>
            </View>
            {score ? <Text className="text-sm text-gray-700">{score}</Text> : null}
          </View>
        </DetailRow>
      ) : null}
    </View>
  );
}

type AvailabilityRow = {
  profile_id: string;
  status: AvailabilityStatus;
};

type TeamMemberRow = {
  profile_id: string;
  role: string | null;
  profiles: { first_name: string; last_name: string } | null;
};

const ANSWER_STYLE: Record<AvailabilityStatus, { symbol: string; color: string; label: string }> = {
  available: { symbol: "✓", color: "#15803d", label: "Available" },
  maybe: { symbol: "?", color: "#b45309", label: "Maybe" },
  unavailable: { symbol: "✗", color: "#b91c1c", label: "Unavailable" },
};

/** A read-only answer in a fixed-width slot, or a dash for no response. */
function AnswerIcon({ status }: { status: AvailabilityStatus | null }) {
  const style = status ? ANSWER_STYLE[status] : null;
  return (
    <Text
      accessibilityLabel={style?.label ?? "No response"}
      style={{ width: 16, textAlign: "center", fontSize: 13, fontWeight: "600", color: style?.color ?? "#9ca3af" }}
    >
      {style?.symbol ?? "—"}
    </Text>
  );
}

/**
 * Players grouped by answer, then coaches and staff with their role, as the
 * web's ResponseList. Only players count in the summary.
 */
function Responses({ roster, answers }: { roster: RosterMember[]; answers: ReadonlyMap<string, AvailabilityStatus> }) {
  const { groups, staff, summary, playerCount } = groupResponses(roster, answers);
  const sections = [
    { key: "available", label: "Available", color: "text-green-700", members: groups.available },
    { key: "maybe", label: "Maybe", color: "text-amber-700", members: groups.maybe },
    { key: "unavailable", label: "Unavailable", color: "text-red-700", members: groups.unavailable },
    { key: "none", label: "No response", color: "text-gray-400", members: groups.none },
  ] as const;

  return (
    <View className="bg-white rounded-2xl border border-gray-100 px-4 py-4">
      <View className="flex-row items-center justify-between mb-3 gap-2">
        <Text className="font-semibold text-gray-900">Responses</Text>
        {summary ? <Text className="text-xs text-gray-500 flex-shrink">{summary}</Text> : null}
      </View>

      {sections.map(({ key, label, color, members }) =>
        members.length > 0 ? (
          <View key={key} accessibilityLabel={`${label} (${members.length})`} className="mb-3">
            <Text className={`text-xs font-semibold uppercase tracking-wide mb-1 ${color}`}>
              {label} ({members.length})
            </Text>
            {members.map((m) => (
              <Text key={m.profileId} className={`text-sm py-0.5 ${key === "none" ? "text-gray-400" : "text-gray-700"}`}>
                {m.name}
              </Text>
            ))}
          </View>
        ) : null
      )}

      {playerCount === 0 ? <Text className="text-sm text-gray-400 mb-3">No players on this team yet.</Text> : null}

      {staff.length > 0 ? (
        <View accessibilityLabel={`Coaches & staff (${staff.length})`} className="pt-3 border-t border-gray-100">
          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Coaches & staff ({staff.length})
          </Text>
          {staff.map((m) => (
            <View key={m.profileId} className="flex-row items-center gap-2 py-0.5">
              <AnswerIcon status={m.status} />
              <Text className="text-sm text-gray-700 flex-shrink">{m.name}</Text>
              <Text className="text-xs text-gray-400">{m.roleLabel}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}


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
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive, disabled }}
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
  const { membership, ownProfile, allMemberships } = useAppContext();

  const [event, setEvent] = useState<EventDetail | null>(null);
  // Everyone's answer, yours included: one source, so answering moves your row.
  const [answers, setAnswers] = useState<Map<string, AvailabilityStatus>>(new Map());
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Who answers: a profile of yours on the event's team, which may not be the
  // one being viewed (review of #105). `chosen` is a pick among several.
  const [chosen, setChosen] = useState<string | null>(null);
  const who = event
    ? answerersFor(event.team_id, allMemberships, membership?.profileId)
    : { answeringAs: null, choices: [] as Answerer[] };
  const answeringAs = who.choices.some((c) => c.profileId === chosen) ? chosen : who.answeringAs;
  const answeringName = who.choices.find((c) => c.profileId === answeringAs)?.name;
  const pickerTitle =
    answeringAs && answeringAs === ownProfile?.id
      ? "Your availability"
      : answeringName
        ? `Availability for ${answeringName}`
        : "Availability";
  const myStatus = answeringAs ? answers.get(answeringAs) ?? null : null;

  async function fetchData() {
    if (!eventId || !membership?.profileId) return;

    const [eventResult, availResult] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, team_id, title, event_type, start_time, end_time, is_cancelled, notes, arrival_time, timezone, opponent, home_away, uniform, score_for, score_against, game_result, teams(timezone, name, home_uniform, away_uniform, home_uniform_color, away_uniform_color), locations(name, address)"
        )
        .eq("id", eventId)
        .single(),
      supabase.from("availability").select("profile_id, status").eq("event_id", eventId),
    ]);

    const detail = (eventResult.data ?? null) as unknown as EventDetail | null;
    if (detail) {
      setEvent(detail);
      navigation.setOptions({ title: gameTitle(detail, detail.teams?.name) });

      // The event's own team, which may not be the one the app has open (an
      // event opened from another team's notification).
      const { data: members } = await supabase
        .from("team_members")
        .select("profile_id, role, profiles(first_name, last_name)")
        .eq("team_id", detail.team_id);
      setRoster(
        ((members ?? []) as unknown as TeamMemberRow[]).map((m) => ({
          profileId: m.profile_id,
          name: [m.profiles?.first_name, m.profiles?.last_name].filter(Boolean).join(" ") || "Unknown",
          role: m.role,
        }))
      );
    }

    const rows = (availResult.data ?? []) as unknown as AvailabilityRow[];
    setAnswers(new Map(rows.map((r) => [r.profile_id, r.status])));
    setLoading(false);
    setRefreshing(false);
  }

  function setAnswer(profileId: string, status: AvailabilityStatus | null) {
    setAnswers((prev) => {
      const next = new Map(prev);
      if (status) next.set(profileId, status);
      else next.delete(profileId);
      return next;
    });
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
    if (!answeringAs || !eventId) return;
    const profileId = answeringAs;
    setRsvpLoading(true);
    const previous = myStatus;
    const next = nextAvailability(previous, clicked);

    setAnswer(profileId, next);
    const { error } =
      next === null
        ? await supabase.from("availability").delete().eq("event_id", eventId).eq("profile_id", profileId)
        : await supabase
            .from("availability")
            .upsert({ event_id: eventId, profile_id: profileId, status: next }, { onConflict: "event_id,profile_id" });
    if (error) {
      setAnswer(profileId, previous);
      Alert.alert("Couldn't save your answer", "Please check your connection and try again.");
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
            <Text className="font-semibold text-gray-900 mb-3">{pickerTitle}</Text>
            {who.choices.length === 0 ? (
              <Text className="text-sm text-gray-500">
                None of your players or your own profile is on this team, so there's nothing to answer here.
              </Text>
            ) : (
              <>
                {who.choices.length > 1 ? (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {who.choices.map((c) => {
                      const selected = c.profileId === answeringAs;
                      return (
                        <TouchableOpacity
                          key={c.profileId}
                          accessibilityRole="button"
                          accessibilityLabel={`Answer for ${c.name}`}
                          accessibilityState={{ selected }}
                          onPress={() => setChosen(c.profileId)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 99,
                            borderWidth: 1,
                            borderColor: selected ? "#0f172a" : "#e5e7eb",
                            backgroundColor: selected ? "#0f172a" : "#ffffff",
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "500", color: selected ? "#ffffff" : "#374151" }}>
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
                <View accessibilityLabel={pickerTitle} className="flex-row gap-2">
                  <RsvpButton
                    label="Available"
                    icon="✓"
                    status="available"
                    current={myStatus}
                    activeColor="#16a34a"
                    onPress={() => handleRsvp("available")}
                    disabled={rsvpLoading || !answeringAs}
                  />
                  <RsvpButton
                    label="Maybe"
                    icon="?"
                    status="maybe"
                    current={myStatus}
                    activeColor="#d97706"
                    onPress={() => handleRsvp("maybe")}
                    disabled={rsvpLoading || !answeringAs}
                  />
                  <RsvpButton
                    label="Unavailable"
                    icon="✗"
                    status="unavailable"
                    current={myStatus}
                    activeColor="#dc2626"
                    onPress={() => handleRsvp("unavailable")}
                    disabled={rsvpLoading || !answeringAs}
                  />
                </View>
                {!answeringAs ? (
                  <Text className="text-xs text-gray-400 text-center mt-2">Choose who you're answering for</Text>
                ) : myStatus ? (
                  <Text className="text-xs text-gray-400 text-center mt-2">Tap again to clear the response</Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {/* Responses: always shown */}
        <Responses roster={roster} answers={answers} />
      </ScrollView>
    </SafeAreaView>
  );
}
