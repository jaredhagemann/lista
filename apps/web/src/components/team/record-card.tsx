import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamRecord } from "@/lib/events/team-record";
import { formatEventTime, formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";

const RESULT = { win: "Win", loss: "Loss", tie: "Tie" } as const;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

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

/**
 * The dashboard's Record card (spec: docs/specs/team-branding-and-labels.md §4):
 * the last game as a scoreline with its date and time, and the season's wins,
 * losses and ties with a bar split in those proportions: wins in the club's
 * secondary color (lista blue outside a club), losses black, ties grey. Only
 * shown once a game has a result.
 */
export function RecordCard({
  teamName,
  record,
  teamTimeZone,
  winColor,
}: {
  teamName: string;
  record: TeamRecord;
  teamTimeZone?: string | null;
  /** The club's secondary color on a club team, else lista blue. */
  winColor: string;
}) {
  const { wins, losses, ties, last } = record;
  const scored = last.scoreFor != null && last.scoreAgainst != null;
  const opponent = `${last.homeAway === "away" ? "at" : "vs"} ${last.opponent ?? "Opponent"}`;
  const zone = resolveTimeZone(last.timeZone ?? teamTimeZone);
  const played = wins + losses + ties;
  const share = (n: number) => `${(n / played) * 100}%`;

  const stats = [
    { label: "Wins", value: wins },
    { label: "Losses", value: losses },
    { label: "Ties", value: ties },
  ];

  return (
    <section aria-label="Record" className="md:col-span-2">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm font-medium">Record</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 sm:gap-10">
          <div className="min-w-0 space-y-2">
            <span className="inline-block rounded bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
              Last game
            </span>
            <div role="table" aria-label="Last game score">
              <ScoreRow name={teamName} score={scored ? String(last.scoreFor) : RESULT[last.result]} />
              <ScoreRow name={opponent} score={scored ? String(last.scoreAgainst) : null} />
            </div>
            <p className="text-sm text-muted-foreground">
              {formatShortEventDate(last.startTime, zone)}, {formatEventTime(last.startTime, zone)}
            </p>
          </div>

          <div className="flex flex-col justify-center gap-4">
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
        </CardContent>
      </Card>
    </section>
  );
}
