import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { teamBranding, type BrandableTeam } from "@/lib/team-branding";
import type { TeamRecord } from "@/lib/events/team-record";
import { formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";

const LETTER = { win: "W", loss: "L", tie: "T" } as const;

/** "12U Girls" → "1G": a stand-in for a team with no logo. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/**
 * The dashboard's Team card (spec: docs/specs/team-branding-and-labels.md §4):
 * the team's logo (its own, or its club's), its name, club and season, its
 * record and latest result once a game has one, and its members.
 */
export function TeamCard({
  team,
  record,
  memberCount,
}: {
  team: BrandableTeam & { season?: string | null; timezone?: string | null };
  record: TeamRecord | null;
  memberCount: number;
}) {
  const brand = teamBranding(team);
  const subtitle = [brand.clubName, team.season].filter(Boolean).join(" · ");
  const last = record?.last;
  const lastLine = last
    ? [
        LETTER[last.result],
        last.scoreFor != null && last.scoreAgainst != null ? `${last.scoreFor}–${last.scoreAgainst}` : null,
        last.opponent ? `${last.homeAway === "away" ? "@" : "vs"} ${last.opponent}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <section aria-label="Team">
      <Card className="h-full">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-4">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={`${brand.displayName} logo`}
                className="size-24 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <div
                aria-hidden
                className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-muted text-3xl font-semibold text-muted-foreground"
              >
                {initials(team.name)}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">{team.name}</p>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          {record && last && lastLine && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Record</dt>
              <dd>
                <span className="font-semibold">{`${record.wins}–${record.losses}–${record.ties}`}</span>
                <span className="text-muted-foreground"> (W–L–T)</span>
              </dd>
              <dt className="text-muted-foreground">Last</dt>
              <dd>
                <span className="font-medium">{lastLine}</span>
                <span className="block text-muted-foreground">
                  {formatShortEventDate(last.startTime, resolveTimeZone(last.timeZone ?? team.timezone))}
                </span>
              </dd>
            </dl>
          )}

          <p className="text-sm text-muted-foreground">
            {memberCount} {memberCount === 1 ? "member" : "members"} ·{" "}
            <Link href="/dashboard/team" className="text-primary hover:underline">
              View roster
            </Link>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
