import { Card } from "@/components/ui/card";
import { RecordBar } from "@/components/team/record-card";
import type { TeamRecord } from "@/lib/events/team-record";

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>{" "}
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

/** A smaller take on the dashboard's Overall Record: the counts, and a thin bar. */
function CompactRecord({ record, winColor }: { record: TeamRecord; winColor: string }) {
  return (
    <div className="w-full space-y-1.5 sm:w-52">
      {/* The bar reads out these counts. */}
      <div aria-hidden className="flex justify-between gap-3">
        <Count value={record.wins} label="W" />
        <Count value={record.losses} label="L" />
        <Count value={record.ties} label="T" />
      </div>
      <RecordBar record={record} winColor={winColor} className="h-1.5" />
    </div>
  );
}

export function ClubTeamList({
  teams,
  winColor,
  failed,
}: {
  teams: { id: string; name: string; record: TeamRecord | null }[];
  winColor: string;
  failed: boolean;
}) {
  return (
    <section>
      <h2 id="club-teams" className="mb-3 text-lg font-semibold">
        Teams
      </h2>
      <ul aria-labelledby="club-teams" className="space-y-2">
        {teams.map((team) => (
          <li key={team.id} aria-label={team.name}>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 font-medium">{team.name}</p>
              {failed ? (
                <p className="text-sm text-muted-foreground">Couldn&apos;t load record</p>
              ) : team.record ? (
                <CompactRecord record={team.record} winColor={winColor} />
              ) : (
                <p className="text-sm text-muted-foreground">No results yet</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
