import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { teamBranding, type BrandableTeam } from "@/lib/team-branding";

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
 * the team's logo (its own, or its club's), its name, club and season, and its
 * members. The record has a card of its own (RecordCard).
 */
export function TeamCard({
  team,
  memberCount,
}: {
  team: BrandableTeam & { season?: string | null };
  memberCount: number;
}) {
  const brand = teamBranding(team);
  const subtitle = [brand.clubName, team.season].filter(Boolean).join(" · ");

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
