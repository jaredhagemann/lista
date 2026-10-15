import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamRecord } from "@/lib/events/team-record";
import { formatEventTime, formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";

const RESULT = { win: "Win", loss: "Loss", tie: "Tie" } as const;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

type LastTournament = {
  title: string;
  placement: string;
  record: TeamRecord | null;
  dates: string;
};

/** One line of the scoreline: a name, a dotted leader, and a score. */
function ScoreRow({ name, score }: { name: string; score: string | null }) {
  return (
    <div role="row" className="flex items-baseline gap-2 text-lg font-semibold text-primary sm:text-xl">
      <span role="cell" className="truncate">
        {name}
      </span>
      <span aria-hidden className="min-w-4 flex-1 border-b-2 border-dotted border-muted-foreground/30" />
      <span role="cell" className="shrink-0 tabular-nums">
        {score}
      </span>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-block rounded bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
      {children}
    </span>
  );
}

/** The last game as a scoreline, with its date and time in its zone. */
function LastGame({
  teamName,
  last,
  teamTimeZone,
}: {
  teamName: string;
  last: TeamRecord["last"];
  teamTimeZone?: string | null;
}) {
  const scored = last.scoreFor != null && last.scoreAgainst != null;
  const opponent = `${last.homeAway === "away" ? "at" : "vs"} ${last.opponent ?? "Opponent"}`;
  const zone = resolveTimeZone(last.timeZone ?? teamTimeZone);
  return (
    <div className="min-w-0 space-y-2">
      <Tag>Last game</Tag>
      <div role="table" aria-label="Last game score">
        <ScoreRow name={teamName} score={scored ? String(last.scoreFor) : RESULT[last.result]} />
        <ScoreRow name={opponent} score={scored ? String(last.scoreAgainst) : null} />
      </div>
      <p className="text-sm text-muted-foreground">
        {formatShortEventDate(last.startTime, zone)}, {formatEventTime(last.startTime, zone)}
      </p>
    </div>
  );
}

/** The last tournament (D8): its name, placement and dates. Its record is a graphic beside it. */
function LastTournamentSummary({ tournament }: { tournament: LastTournament }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="truncate text-lg font-semibold text-primary sm:text-xl">{tournament.title}</p>
      {tournament.placement && <p className="text-lg font-semibold sm:text-xl">{tournament.placement}</p>}
      <p className="text-sm text-muted-foreground">{tournament.dates}</p>
    </div>
  );
}

/**
 * Wins, losses and ties, with a bar split in those proportions. Beside a last
 * game or tournament it has its own heading, matching the "Last game" tag
 * (2026-10-14).
 */
function Stats({ record, winColor, heading }: { record: TeamRecord; winColor: string; heading?: string }) {
  const { wins, losses, ties } = record;
  const played = wins + losses + ties;
  const share = (n: number) => `${(n / played) * 100}%`;
  const stats = [
    { label: "Wins", value: wins },
    { label: "Losses", value: losses },
    { label: "Ties", value: ties },
  ];
  return (
    <div className="flex flex-col justify-center gap-4">
      {heading && (
        <div>
          <Tag>{heading}</Tag>
        </div>
      )}
      <div className="grid grid-cols-3 text-center">
        {stats.map(({ label, value }) => (
          <div key={label}>
            <p className="text-4xl font-light tabular-nums">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div
        role="img"
        aria-label={`${plural(wins, "win", "wins")}, ${plural(losses, "loss", "losses")}, ${plural(ties, "tie", "ties")}`}
        className="flex h-3 overflow-hidden rounded-full bg-muted"
      >
        <div style={{ width: share(wins), backgroundColor: winColor }} />
        {/* Black would vanish on the dark theme's card, so it turns white there. */}
        <div className="bg-black dark:bg-white" style={{ width: share(losses) }} />
        <div className="bg-neutral-400" style={{ width: share(ties) }} />
      </div>
    </div>
  );
}

/** A headed part of the card: a league's record, or the overall one. */
function RecordSection({ heading, label, children }: { heading: string; label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="space-y-3">
      <h3 className="text-sm font-semibold">{heading}</h3>
      {children}
    </section>
  );
}

/**
 * The dashboard's Record card (spec: docs/specs/team-branding-and-labels.md §4;
 * docs/specs/tournaments-and-leagues.md D8, D9, layout revised 2026-10-14), top
 * to bottom:
 *
 *   - a section per active league: its own last game and record graphic, or
 *     "No results yet". Without leagues, the team's last game instead
 *   - the last tournament, laid out as a league section: the latest finished
 *     one, placed or not, with its placement and dates, and its own record
 *     graphic. It stays until a newer one finishes, whatever games follow it
 *   - "Overall Record" across the card: every game counts (D3)
 *
 * The graphic is the wins, losses and ties with a bar split in those
 * proportions: wins in the club's secondary color (lista blue outside a club),
 * losses black, ties grey. The card shows once a game has a result, a
 * tournament has finished (review TL-022), or the team has an active league,
 * which reads "No results yet" until it has one (decided 2026-10-15).
 */
export function RecordCard({
  teamName,
  record,
  teamTimeZone,
  winColor,
  lastTournament = null,
  leagues = [],
  failed = false,
}: {
  /** A read behind the card failed: say so, rather than show a record from part of it (TL-026). */
  failed?: boolean;
  teamName: string;
  /** Null before any game has a result. */
  record: TeamRecord | null;
  teamTimeZone?: string | null;
  /** The club's secondary color on a club team, else lista blue. */
  winColor: string;
  /** The latest finished tournament. */
  lastTournament?: LastTournament | null;
  /** The team's active leagues, each with its own record, or null before a result (D9). */
  leagues?: { id: string; label: string; record: TeamRecord | null }[];
}) {
  return (
    <section aria-label="Record" className="md:col-span-2">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm font-medium">Record</CardTitle>
        </CardHeader>
        {failed ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the record. Refresh the page to try again.</p>
          </CardContent>
        ) : (
          <CardContent className="space-y-6 divide-y [&>*:not(:first-child)]:pt-6">
            {leagues.length > 0
              ? leagues.map((l) => (
                  <RecordSection key={l.id} heading={l.label} label={l.label}>
                    {l.record ? (
                      <div className="grid gap-6 sm:grid-cols-2 sm:gap-10">
                        <LastGame teamName={teamName} last={l.record.last} teamTimeZone={teamTimeZone} />
                        <Stats record={l.record} winColor={winColor} heading="League Record" />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No results yet</p>
                    )}
                  </RecordSection>
                ))
              : record && <LastGame teamName={teamName} last={record.last} teamTimeZone={teamTimeZone} />}
            {/* Laid out as a league section is: the summary, and its own record graphic (2026-10-14). */}
            {lastTournament && (
              <RecordSection heading="Last tournament" label="Last tournament">
                <div className="grid gap-6 sm:grid-cols-2 sm:gap-10">
                  <LastTournamentSummary tournament={lastTournament} />
                  {lastTournament.record && (
                    <Stats record={lastTournament.record} winColor={winColor} heading="Tournament Record" />
                  )}
                </div>
              </RecordSection>
            )}
            {/* Always last, across the card: every game counts here (D3). */}
            {record && (
              <RecordSection heading="Overall Record" label="Overall record">
                <Stats record={record} winColor={winColor} />
              </RecordSection>
            )}
          </CardContent>
        )}
      </Card>
    </section>
  );
}
