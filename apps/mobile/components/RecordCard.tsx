import { Text, View } from "react-native";
import type { TeamRecord } from "../lib/team-record";
import { eventZone, formatEventClock, formatEventDay } from "../lib/event-time";

const RESULT = { win: "Win", loss: "Loss", tie: "Tie" } as const;

/**
 * The last tournament with a placement, shown as the last result until a game
 * starts after it ended (docs/specs/tournaments-and-leagues.md, D8).
 */
export type LastTournament = {
  title: string;
  placement: string;
  /** Its own games' record, once one has a result. */
  record: Pick<TeamRecord, "wins" | "losses" | "ties"> | null;
  dates: string;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line of the scoreline: a name, a dotted leader, and a score. */
function ScoreRow({ name, score }: { name: string; score: string | null }) {
  return (
    <View
      accessible
      accessibilityLabel={score ? `${name} ${score}` : name}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}
    >
      <Text className="text-lg font-semibold text-gray-900 flex-shrink" numberOfLines={1}>
        {name}
      </Text>
      <View style={{ flex: 1, minWidth: 16, borderBottomWidth: 2, borderStyle: "dotted", borderColor: "#d1d5db", marginBottom: 6 }} />
      <Text className="text-lg font-semibold text-gray-900">{score}</Text>
    </View>
  );
}

/**
 * The home screen's Record card, as the web dashboard's (spec:
 * docs/specs/team-branding-and-labels.md §4): the last game as a scoreline with
 * its date and time, and the wins, losses and ties with a bar split in those
 * proportions: wins in `winColor` (the club's secondary color, else lista
 * blue), losses black, ties grey. Shown only once a game has a result.
 */
export function RecordCard({
  teamName,
  record,
  teamTimeZone,
  winColor,
  lastTournament = null,
}: {
  teamName: string;
  record: TeamRecord;
  teamTimeZone: string | null;
  winColor: string;
  lastTournament?: LastTournament | null;
}) {
  const { wins, losses, ties, last } = record;
  const scored = last.scoreFor != null && last.scoreAgainst != null;
  const opponent = `${last.homeAway === "away" ? "at" : "vs"} ${last.opponent ?? "Opponent"}`;
  const zone = eventZone({ timezone: last.timeZone, teams: { timezone: teamTimeZone } });
  const played = wins + losses + ties;
  const share = (n: number): `${number}%` => `${(n / played) * 100}%`;

  const stats = [
    { label: "Wins", value: wins },
    { label: "Losses", value: losses },
    { label: "Ties", value: ties },
  ];

  return (
    <View accessibilityLabel="Record" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <View className="px-4 pt-4 pb-3 border-b border-gray-50">
        <Text className="font-semibold text-gray-900">Record</Text>
      </View>
      <View className="p-4 gap-5">
        {lastTournament ? (
          <View className="gap-1">
            <View className="self-start bg-gray-900 rounded px-2 py-0.5 mb-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-white">Last tournament</Text>
            </View>
            <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
              {lastTournament.title}
            </Text>
            <View className="flex-row flex-wrap items-baseline gap-3">
              <Text className="text-lg font-semibold text-gray-900">{lastTournament.placement}</Text>
              {lastTournament.record ? (
                <Text
                  accessibilityLabel={`Tournament record ${lastTournament.record.wins}–${lastTournament.record.losses}–${lastTournament.record.ties}`}
                  className="text-sm text-gray-500"
                >
                  {lastTournament.record.wins}–{lastTournament.record.losses}–{lastTournament.record.ties}
                </Text>
              ) : null}
            </View>
            <Text className="text-sm text-gray-500">{lastTournament.dates}</Text>
          </View>
        ) : (
          <View className="gap-1">
            <View className="self-start bg-gray-900 rounded px-2 py-0.5 mb-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-white">Last game</Text>
            </View>
            <ScoreRow name={teamName} score={scored ? String(last.scoreFor) : RESULT[last.result]} />
            <ScoreRow name={opponent} score={scored ? String(last.scoreAgainst) : null} />
            <Text className="text-sm text-gray-500">
              {formatEventDay(last.startTime, zone)}, {formatEventClock(last.startTime, zone)}
            </Text>
          </View>
        )}

        <View className="gap-3">
          <View className="flex-row">
            {stats.map(({ label, value }) => (
              <View key={label} accessible accessibilityLabel={`${value} ${label}`} style={{ flex: 1, alignItems: "center" }}>
                <Text className="text-4xl font-light text-gray-900">{value}</Text>
                <Text className="text-sm text-gray-500">{label}</Text>
              </View>
            ))}
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${plural(wins, "win", "wins")}, ${plural(losses, "loss", "losses")}, ${plural(ties, "tie", "ties")}`}
            style={{ flexDirection: "row", height: 12, borderRadius: 99, overflow: "hidden", backgroundColor: "#f3f4f6" }}
          >
            <View style={{ width: share(wins), backgroundColor: winColor }} />
            <View style={{ width: share(losses), backgroundColor: "#000000" }} />
            <View style={{ width: share(ties), backgroundColor: "#a3a3a3" }} />
          </View>
        </View>
      </View>
    </View>
  );
}
