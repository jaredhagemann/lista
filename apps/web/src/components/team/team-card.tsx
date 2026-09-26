import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { teamBranding, type BrandableTeam } from "@/lib/team-branding";
import { displayLabel } from "@/lib/labels";

export type TeamCardMember = {
  id: string;
  role: string;
  profiles: { first_name: string | null; last_name: string | null } | null;
};

/** Coaches and staff first, in the roster's order; then players. */
const ROLE_ORDER: Record<string, number> = { director: 0, coach: 1, manager: 2, player: 4 };

function nameOf(member: TeamCardMember) {
  return [member.profiles?.first_name, member.profiles?.last_name].filter(Boolean).join(" ") || "Member";
}

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
 * members by name and role, each linking to their page. The record has a card of its own (RecordCard).
 */
export function TeamCard({
  team,
  members,
}: {
  team: BrandableTeam & { season?: string | null };
  members: TeamCardMember[];
}) {
  const memberCount = members.length;
  const listed = members
    .map((member) => ({ ...member, name: nameOf(member) }))
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.name.localeCompare(b.name)
    );
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


          {listed.length > 0 && (
            <ul aria-label="Members" className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
              {listed.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <Link href={`/dashboard/team/${member.id}`} className="truncate font-medium hover:underline">
                    {member.name}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{displayLabel(member.role)}</span>
                </li>
              ))}
            </ul>
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
