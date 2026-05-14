import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { MultiTeamCell } from "@/components/club/multi-team-cell";

export const metadata = { title: "Club Members" };

const ROLE_LABELS: Record<string, string> = {
  coach: "Coach",
  manager: "Manager",
  player: "Player",
  parent: "Parent",
  director: "Director",
};

type SortKey = "name" | "birthday" | "jersey" | "team" | "role";

function sortHref(
  col: SortKey,
  currentSort: SortKey,
  currentDir: string,
  filters: { q?: string; team?: string; role?: string }
) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.team) params.set("team", filters.team);
  if (filters.role) params.set("role", filters.role);
  params.set("sort", col);
  params.set("dir", currentSort === col && currentDir === "asc" ? "desc" : "asc");
  return `?${params}`;
}

function SortIcon({ col, currentSort, currentDir }: { col: SortKey; currentSort: SortKey; currentDir: string }) {
  if (col !== currentSort) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return currentDir === "asc"
    ? <ChevronUp className="h-3 w-3" />
    : <ChevronDown className="h-3 w-3" />;
}

export default async function ClubMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; team?: string; role?: string; sort?: string; dir?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile?.active_team_id ?? "")
    .single();

  const orgId = team?.organization_id;
  if (!orgId) redirect("/dashboard");

  const { q, team: teamFilter, role: roleFilter, sort, dir } = await searchParams;
  const currentSort: SortKey = (sort as SortKey) ?? "name";
  const currentDir = dir === "desc" ? "desc" : "asc";
  const filters = { q, team: teamFilter, role: roleFilter };

  // Fetch all teams in org (for filter UI)
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");

  // Fetch all team members across all org teams
  const teamIds = (teams ?? []).map((t) => t.id);

  let membersQuery = supabase
    .from("team_members")
    .select(
      "team_id, role, jersey_number, profiles(id, first_name, last_name, birthday), teams(name)"
    )
    .in("team_id", teamIds.length ? teamIds : [""]);

  if (teamFilter) membersQuery = membersQuery.eq("team_id", teamFilter);
  if (roleFilter) membersQuery = membersQuery.eq("role", roleFilter);

  const { data: memberRows } = await membersQuery;

  type RawRow = {
    team_id: string;
    role: string;
    jersey_number: number | null;
    profiles: { id: string; first_name: string | null; last_name: string | null; birthday: string | null } | null;
    teams: { name: string } | null;
  };

  const rows = (memberRows ?? []) as RawRow[];

  // ── Group by person ───────────────────────────────────────────────────────────

  type GroupedMember = {
    profileId: string;
    name: string;
    birthday: string | null;
    roles: string[];        // distinct roles across all memberships
    teamNames: string[];    // all team names, deduplicated
    jerseyNumbers: number[];// distinct jersey numbers (player memberships only)
    isPlayer: boolean;
  };

  const grouped = new Map<string, GroupedMember>();

  for (const row of rows) {
    const profileId = row.profiles?.id ?? `anon-${row.team_id}`;
    const teamName = (row.teams as { name: string } | null)?.name ?? null;

    const existing = grouped.get(profileId);
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role);
      if (teamName && !existing.teamNames.includes(teamName)) existing.teamNames.push(teamName);
      if (row.role === "player") {
        existing.isPlayer = true;
        if (row.jersey_number != null && !existing.jerseyNumbers.includes(row.jersey_number)) {
          existing.jerseyNumbers.push(row.jersey_number);
        }
      }
    } else {
      grouped.set(profileId, {
        profileId,
        name: [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") || "—",
        birthday: row.profiles?.birthday ?? null,
        roles: [row.role],
        teamNames: teamName ? [teamName] : [],
        jerseyNumbers: row.role === "player" && row.jersey_number != null ? [row.jersey_number] : [],
        isPlayer: row.role === "player",
      });
    }
  }

  let members = Array.from(grouped.values());

  // ── Name filter ───────────────────────────────────────────────────────────────

  if (q) {
    const lower = q.toLowerCase();
    members = members.filter((m) => m.name.toLowerCase().includes(lower));
  }

  // ── Sort ──────────────────────────────────────────────────────────────────────

  const asc = currentDir === "asc";
  members = [...members].sort((a, b) => {
    let va: string | number | null;
    let vb: string | number | null;

    switch (currentSort) {
      case "birthday":
        va = a.birthday;
        vb = b.birthday;
        break;
      case "jersey":
        va = a.jerseyNumbers.length > 0 ? Math.min(...a.jerseyNumbers) : null;
        vb = b.jerseyNumbers.length > 0 ? Math.min(...b.jerseyNumbers) : null;
        break;
      case "team":
        // Sort by number of teams (fewer first asc), then alphabetically by first team name
        va = a.teamNames.length === 1 ? a.teamNames[0] : `\u{10FFFF}${a.teamNames.sort().join(",")}`;
        vb = b.teamNames.length === 1 ? b.teamNames[0] : `\u{10FFFF}${b.teamNames.sort().join(",")}`;
        break;
      case "role":
        va = [...a.roles].sort().join(",");
        vb = [...b.roles].sort().join(",");
        break;
      default: // "name"
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
    }

    if (va === null && vb === null) return 0;
    if (va === null) return asc ? 1 : -1;
    if (vb === null) return asc ? -1 : 1;
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Members</h1>

      <form className="flex flex-wrap gap-2">
        <Input
          name="q"
          placeholder="Search by name…"
          defaultValue={q ?? ""}
          className="max-w-xs"
        />
        <select
          name="team"
          defaultValue={teamFilter ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All teams</option>
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          name="role"
          defaultValue={roleFilter ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Filter
        </button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  { col: "name", label: "Name" },
                  { col: "birthday", label: "Birth Date" },
                  { col: "jersey", label: "Jersey #" },
                  { col: "team", label: "Team" },
                  { col: "role", label: "Role" },
                ] as { col: SortKey; label: string }[]
              ).map(({ col, label }) => (
                <TableHead key={col}>
                  <a
                    href={sortHref(col, currentSort, currentDir, filters)}
                    className="flex items-center gap-1 hover:text-foreground select-none"
                  >
                    {label}
                    <SortIcon col={col} currentSort={currentSort} currentDir={currentDir} />
                  </a>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No members found.
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => {
                const birthday = m.isPlayer && m.birthday
                  ? new Date(m.birthday).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : null;
                const jerseyDisplay = m.isPlayer && m.jerseyNumbers.length > 0
                  ? m.jerseyNumbers.sort((a, b) => a - b).map((n) => `#${n}`).join(", ")
                  : null;
                return (
                  <TableRow key={m.profileId}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {birthday ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {jerseyDisplay ?? "—"}
                    </TableCell>
                    <TableCell>
                      <MultiTeamCell teams={m.teamNames} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {ROLE_LABELS[r] ?? r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</p>
    </div>
  );
}
