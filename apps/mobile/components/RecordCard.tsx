import { Pressable, Text, View } from "react-native";
import type { TeamRecord } from "../lib/team-record";
import type { RemainingGame } from "../lib/tournament";
import { eventZone, formatEventClock, formatEventDay } from "../lib/event-time";

const RESULT = { win: "Win", loss: "Loss", tie: "Tie" } as const;

type Counts = Pick<TeamRecord, "wins" | "losses" | "ties">;

/**
 * The card's tournament: the one underway once it has a result ("current",
 * docs/specs/tournament-in-progress-record.md), else the latest finished one,
 * placed or not (docs/specs/tournaments-and-leagues.md, D8 revised 2026-10-14).
 */
export type CardTournament = {
  title: string;
  /** "2nd place", or "" without a placement. */
  placement: string;
  /** Its own games' record, once one has a result. */
  record: TeamRecord | null;
  dates: string;
  /** Underway, with a result: headed "Current tournament", with its latest result and remaining games. */
  current?: boolean;
  remaining?: RemainingGame[];
};

/** An active league's section (D9): its own record, or null before a result. */
export type LeagueRow = { id: string; label: string; record: TeamRecord | null };

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

function Tag({ children }: { children: string }) {
  return (
    <View className="self-start bg-gray-900 rounded px-2 py-0.5 mb-1">
      <Text className="text-xs font-semibold uppercase tracking-wide text-white">{children}</Text>
    </View>
  );
}

/** A headed part of the card: a league, the tournament, or the overall record. */
function Section({
  label,
  heading,
  badge,
  children,
}: {
  label: string;
  heading: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <View accessibilityLabel={label} className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="text-sm font-semibold text-gray-900">{heading}</Text>
        {badge ? (
          <View className="bg-gray-100 rounded-full px-2 py-0.5">
            <Text className="text-xs font-medium text-gray-700">{badge}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * A tournament's games still to come, each opening its game (Q7): "Semifinal ·
 * at Eagles", then its date and time, or "Awaiting result" once it has started (Q3).
 */
function RemainingGames({
  games,
  teamTimeZone,
  onOpenGame,
}: {
  games: RemainingGame[];
  teamTimeZone: string | null;
  onOpenGame?: (id: string) => void;
}) {
  return (
    <View className="gap-1">
      <Tag>Remaining games</Tag>
      <View accessibilityLabel="Remaining games">
        {games.map((g) => {
          const opponent = g.opponent ? `${g.homeAway === "away" ? "at" : "vs"} ${g.opponent}` : "Opponent TBD";
          const title = g.round ? `${g.round} · ${opponent}` : opponent;
          const zone = eventZone({ timezone: g.timeZone, teams: { timezone: teamTimeZone } });
          const when = g.awaiting
            ? "Awaiting result"
            : `${formatEventDay(g.startTime, zone)}, ${formatEventClock(g.startTime, zone)}`;
          return (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${when}`}
              onPress={() => onOpenGame?.(g.id)}
              className="py-2 border-b border-gray-50"
            >
              <Text className="font-medium text-gray-900">{title}</Text>
              <Text className="text-sm text-gray-500">{when}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The home screen's Record card, as the web dashboard's (spec:
 * docs/specs/team-branding-and-labels.md §4; docs/specs/tournaments-and-leagues.md
 * D8, D9, revised 2026-10-14 and 2026-10-15). Top to bottom:
 *
 *   - a section per active league: its own last game and "League Record", or
 *     "No results yet". Without leagues, the team's last game instead
 *   - the tournament, with its placement and dates and its own "Tournament
 *     Record". While one is underway with a result, "Current tournament" with
 *     "Now", its latest result and its remaining games (docs/specs/tournament-
 *     in-progress-record.md). Otherwise "Last tournament": the latest finished
 *     one, placed or not
 *   - "Overall Record": every game counts (D3)
 *
 * Without leagues, the top "Last game" is left out when it's the current
 * tournament's latest result, so the game shows once (Q2).
 *
 * A record is the wins, losses and ties with a bar split in those proportions:
 * wins in `winColor` (the club's secondary color, else lista blue), losses
 * black, ties grey. The card shows once a game has a result, a tournament has
 * finished, or the team has an active league.
 */
export function RecordCard({
  teamName,
  record,
  teamTimeZone,
  winColor,
  tournament = null,
  leagues = [],
  status = "ok",
  onRetry,
  onOpenGame,
}: {
  /**
   * A read behind the card failed (TL-026): "failed" when nothing had loaded, so
   * the card says so rather than show a record from part of the reads; "stale"
   * when a refresh failed, so it keeps the record it had and says so.
   */
  status?: "ok" | "failed" | "stale";
  onRetry?: () => void;
  teamName: string;
  /** Null before any game has a result. */
  record: TeamRecord | null;
  teamTimeZone: string | null;
  winColor: string;
  /** The tournament underway with a result, else the latest finished one. */
  tournament?: CardTournament | null;
  leagues?: LeagueRow[];
  /** Opens a remaining game's screen. */
  onOpenGame?: (id: string) => void;
}) {
  const latest = tournament?.current ? tournament.record?.last : undefined;
  // Q2: the team's last game is the current tournament's latest result: show it once, there.
  const lastGameShown = record && !(latest?.id && latest.id === record.last.id);
  return (
    <View accessibilityLabel="Record" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <View className="px-4 pt-4 pb-3 border-b border-gray-50">
        <Text className="font-semibold text-gray-900">Record</Text>
      </View>
      {status === "failed" ? (
        <View className="p-4 gap-3">
          <Text className="text-sm text-gray-500">Couldn't load the record.</Text>
          {onRetry ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} className="self-start">
              <Text className="text-sm font-semibold text-blue-600">Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View className="p-4 gap-6">
          {status === "stale" ? (
            <Text className="text-sm text-gray-500">Couldn't refresh the record. Pull down to try again.</Text>
          ) : null}
          {leagues.length > 0
            ? leagues.map((l) => (
                <Section key={l.id} label={l.label} heading={l.label}>
                  {l.record ? (
                    <>
                      <LastGame teamName={teamName} last={l.record.last} teamTimeZone={teamTimeZone} />
                      <Stats record={l.record} winColor={winColor} heading="League Record" />
                    </>
                  ) : (
                    <Text className="text-sm text-gray-500">No results yet</Text>
                  )}
                </Section>
              ))
            : record && lastGameShown
              ? <LastGame teamName={teamName} last={record.last} teamTimeZone={teamTimeZone} />
              : null}

          {tournament ? (
            <Section
              label={tournament.current ? "Current tournament" : "Last tournament"}
              heading={tournament.current ? "Current tournament" : "Last tournament"}
              badge={tournament.current ? "Now" : undefined}
            >
              <View className="gap-1">
                <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
                  {tournament.title}
                </Text>
                {tournament.placement ? (
                  <Text className="text-lg font-semibold text-gray-900">{tournament.placement}</Text>
                ) : null}
                <Text className="text-sm text-gray-500">{tournament.dates}</Text>
              </View>
              {latest ? (
                <LastGame teamName={teamName} last={latest} teamTimeZone={teamTimeZone} tag="Latest result" />
              ) : null}
              {tournament.record ? (
                <Stats record={tournament.record} winColor={winColor} heading="Tournament Record" />
              ) : null}
              {/* Nothing when every game has a result: bracket games are often added late (Q5). */}
              {tournament.current && tournament.remaining && tournament.remaining.length > 0 ? (
                <RemainingGames games={tournament.remaining} teamTimeZone={teamTimeZone} onOpenGame={onOpenGame} />
              ) : null}
            </Section>
          ) : null}

          {/* Always last: every game counts here (D3). */}
          {record ? (
            <Section label="Overall record" heading="Overall Record">
              <Stats record={record} winColor={winColor} />
            </Section>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** The last game, as a scoreline with its date and time. */
function LastGame({
  teamName,
  last,
  teamTimeZone,
  tag = "Last game",
}: {
  teamName: string;
  last: TeamRecord["last"];
  teamTimeZone: string | null;
  /** "Latest result" in a tournament underway. */
  tag?: string;
}) {
  const scored = last.scoreFor != null && last.scoreAgainst != null;
  const opponent = `${last.homeAway === "away" ? "at" : "vs"} ${last.opponent ?? "Opponent"}`;
  const zone = eventZone({ timezone: last.timeZone, teams: { timezone: teamTimeZone } });
  return (
    <View className="gap-1">
      <Tag>{tag}</Tag>
      <ScoreRow name={teamName} score={scored ? String(last.scoreFor) : RESULT[last.result]} />
      <ScoreRow name={opponent} score={scored ? String(last.scoreAgainst) : null} />
      <Text className="text-sm text-gray-500">
        {formatEventDay(last.startTime, zone)}, {formatEventClock(last.startTime, zone)}
      </Text>
    </View>
  );
}

/**
 * Wins, losses and ties, with a bar split in those proportions. A league's or a
 * tournament's has its own heading, as on the web.
 */
function Stats({ record, winColor, heading }: { record: Counts; winColor: string; heading?: string }) {
  const { wins, losses, ties } = record;
  const played = wins + losses + ties;
  const share = (n: number): `${number}%` => `${(n / played) * 100}%`;
  const stats = [
    { label: "Wins", value: wins },
    { label: "Losses", value: losses },
    { label: "Ties", value: ties },
  ];
  return (
    <View className="gap-3">
      {heading ? <Tag>{heading}</Tag> : null}
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
  );
}
