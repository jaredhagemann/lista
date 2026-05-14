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

  type MemberRow = {
    team_id: string;
    role: string;
    jersey_number: number | null;
    profiles: { id: string; first_name: string | null; last_name: string | null; birthday: string | null } | null;
    teams: { name: string } | null;
  };

  let members = (memberRows ?? []) as MemberRow[];

  // Name filter
  if (q) {
    const lower = q.toLowerCase();
    members = members.filter((m) => {
      const name = [m.profiles?.first_name, m.profiles?.last_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return name.includes(lower);
    });
  }

  // Sort
  const asc = currentDir === "asc";
  members = [...members].sort((a, b) => {
    let va: string | number | null;
    let vb: string | number | null;

    switch (currentSort) {
      case "birthday":
        va = a.profiles?.birthday ?? null;
        vb = b.profiles?.birthday ?? null;
        break;
      case "jersey":
        va = a.jersey_number ?? null;
        vb = b.jersey_number ?? null;
        break;
      case "team":
        va = (a.teams as { name: string } | null)?.name ?? null;
        vb = (b.teams as { name: string } | null)?.name ?? null;
        break;
      case "role":
        va = a.role;
        vb = b.role;
        break;
      default: // "name"
        va = [a.profiles?.last_name, a.profiles?.first_name].filter(Boolean).join(" ").toLowerCase();
        vb = [b.profiles?.last_name, b.profiles?.first_name].filter(Boolean).join(" ").toLowerCase();
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
              members.map((m, i) => {
                const name = [m.profiles?.first_name, m.profiles?.last_name]
                  .filter(Boolean)
                  .join(" ") || "—";
                const isPlayer = m.role === "player";
                const birthday = isPlayer && m.profiles?.birthday
                  ? new Date(m.profiles.birthday).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : null;
                return (
                  <TableRow key={`${m.team_id}-${m.profiles?.id ?? i}`}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {birthday ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isPlayer && m.jersey_number != null ? `#${m.jersey_number}` : "—"}
                    </TableCell>
                    <TableCell>{(m.teams as { name: string } | null)?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </Badge>
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
