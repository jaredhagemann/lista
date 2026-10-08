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
import { eventZone, formatEventClock, formatEventDay } from "../../lib/event-time";
import { useAppContext } from "../../contexts/AppContext";
import { displayLabel } from "../../lib/labels";
import { gameTitle } from "../../lib/game-display";
import { teamRecord, type ResultGame, type TeamRecord } from "../../lib/team-record";
import { TeamCard, type TeamCardMember } from "../../components/TeamCard";
import { RecordCard, type LastTournament } from "../../components/RecordCard";
import { eventTypeColors, PART_OF_COLOR } from "../../lib/event-type-colors";
import {
  gameCount,
  isTournament,
  isUnderway,
  placementText,
  tournamentDates,
  tournamentLine,
  tournamentRecord,
} from "../../lib/tournament";

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
  /** A game's tournament and round; a tournament's game count. */
  tournament_id: string | null;
  round: string | null;
  tournament: { title: string } | null;
  games: { count: number }[] | null;
};

/** A finished tournament with a placement, for the Record card (D8). */
type PlacedTournament = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  timezone: string | null;
  placement_rank: number | null;
  placement_label: string | null;
  teams: { timezone: string | null } | null;
};

/**
 * "Thu, Sep 17, 4:00 PM MDT", in the event's own zone (BUG-010). A tournament
 * spans whole days: its dates and games instead (D13).
 */
function formatEventTime(event: Event) {
  if (isTournament(event)) {
    const games = event.games?.[0]?.count ?? 0;
    return games > 0 ? `${tournamentDates(event)} · ${gameCount(games)}` : tournamentDates(event);
  }
  const zone = eventZone(event);
  return `${formatEventDay(event.start_time, zone)}, ${formatEventClock(event.start_time, zone)}`;
}


export default function HomeScreen() {
  const router = useRouter();
  const { membership, loading: membershipLoading, refresh } = useAppContext();

  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<TeamCardMember[]>([]);
  // Games with a result, for the Record card; the team's zone for its date line.
  const [record, setRecord] = useState<TeamRecord | null>(null);
  const [lastTournament, setLastTournament] = useState<LastTournament | null>(null);
  const [teamTimeZone, setTeamTimeZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    if (!membership?.teamId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const now = new Date().toISOString();
    const [eventsResult, membersResult, resultsResult, placedResult] = await Promise.all([
      supabase
        .from("events")
        .select(
          "id, title, event_type, start_time, end_time, is_cancelled, timezone, opponent, home_away, score_for, score_against, tournament_id, round, teams(timezone, name), locations(name), tournament:tournament_id(title), games:events!tournament_id(count)"
        )
        .eq("team_id", membership.teamId)
        .eq("is_cancelled", false)
        // By end time: a tournament stays listed while it's underway (spec §4).
        .gt("end_time", now)
        .order("start_time", { ascending: true })
        .limit(5),
      supabase
        .from("team_members")
        .select("id, role, profiles(first_name, last_name)")
        .eq("team_id", membership.teamId),
      supabase
        .from("events")
        .select("start_time, timezone, opponent, home_away, game_result, score_for, score_against, tournament_id, teams(timezone)")
        .eq("team_id", membership.teamId)
        .eq("event_type", "game")
        .not("game_result", "is", null),
      // The latest finished tournament with a placement, for the Record card (D8).
      supabase
        .from("events")
        .select("id, title, start_time, end_time, timezone, placement_rank, placement_label, teams(timezone)")
        .eq("team_id", membership.teamId)
        .eq("event_type", "tournament")
        .eq("is_cancelled", false)
        .lte("end_time", now)
        .or("placement_rank.not.is.null,placement_label.not.is.null")
        .order("end_time", { ascending: false })
        .limit(1),
    ]);

    setEvents((eventsResult.data ?? []) as unknown as Event[]);
    setMembers((membersResult.data ?? []) as unknown as TeamCardMember[]);
    const results = (resultsResult.data ?? []) as unknown as (ResultGame & {
      tournament_id: string | null;
      teams: { timezone: string | null } | null;
    })[];
    const overall = teamRecord(results);
    setRecord(overall);
    // D8: the tournament is the last result until a game starts after it ended.
    const placed = ((placedResult.data ?? []) as unknown as PlacedTournament[])[0];
    const placement = placed ? placementText(placed) : null;
    setLastTournament(
      // With no game results at all, a placement is still a result (review TL-022).
      placed && placement && (!overall || Date.parse(placed.end_time) > Date.parse(overall.last.startTime))
        ? {
            title: placed.title,
            placement,
            record: tournamentRecord(placed.id, results),
            dates: tournamentDates(placed),
          }
        : null
    );
    setTeamTimeZone(results[0]?.teams?.timezone ?? null);
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
                const badge = eventTypeColors(event.event_type);
                const tournament = isTournament(event);
                const partOf = tournamentLine(event);
                return (
                  <TouchableOpacity
                    key={event.id}
                    accessibilityLabel={tournament ? `${event.title}, tournament` : undefined}
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
                        {gameTitle(event, event.teams?.name)}
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
                          className="font-medium"
                        >
                          {displayLabel(event.event_type)}
                        </Text>
                      </View>
                    </View>
                    {partOf ? (
                      <Text style={{ fontSize: 12, color: PART_OF_COLOR, marginTop: 1 }}>{partOf}</Text>
                    ) : null}
                    <View className="flex-row items-center gap-2 mt-0.5">
                      <Text className="text-sm text-gray-500 flex-shrink">
                        {formatEventTime(event)}
                      </Text>
                      {tournament && isUnderway(event) ? (
                        <View style={{ backgroundColor: "#0f172a", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99 }}>
                          <Text style={{ color: "#ffffff", fontSize: 10, fontWeight: "700" }}>Now</Text>
                        </View>
                      ) : null}
                    </View>
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

        <TeamCard
          teamName={membership.teamName}
          clubName={membership.clubName}
          season={membership.season}
          logoUrl={membership.logoUrl}
          members={members}
          onOpenMember={(id) => router.push(`/(app)/team/${id}` as any)}
          onOpenRoster={() => router.push("/(app)/team" as any)}
        />

        {record || lastTournament ? (
          <View className="mt-4">
            <RecordCard
              teamName={membership.teamName}
              record={record}
              teamTimeZone={teamTimeZone}
              winColor={membership.winColor}
              lastTournament={lastTournament}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
