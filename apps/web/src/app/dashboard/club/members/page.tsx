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

export const metadata = { title: "Club Members" };

const ROLE_LABELS: Record<string, string> = {
  coach: "Coach",
  manager: "Manager",
  player: "Player",
  parent: "Parent",
  director: "Director",
};

export default async function ClubMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; team?: string; role?: string }>;
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

  const { q, team: teamFilter, role: roleFilter } = await searchParams;

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
      "team_id, role, profiles(id, first_name, last_name, email), teams(name)"
    )
    .in("team_id", teamIds.length ? teamIds : [""]);

  if (teamFilter) membersQuery = membersQuery.eq("team_id", teamFilter);
  if (roleFilter) membersQuery = membersQuery.eq("role", roleFilter);

  const { data: memberRows } = await membersQuery.order("role");

  type MemberRow = {
    team_id: string;
    role: string;
    profiles: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
    teams: { name: string } | null;
  };

  let members = (memberRows ?? []) as MemberRow[];

  // Client-side name filter (simple, avoids complex ilike on joined field)
  if (q) {
    const lower = q.toLowerCase();
    members = members.filter((m) => {
      const name = [m.profiles?.first_name, m.profiles?.last_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return name.includes(lower) || m.profiles?.email?.toLowerCase().includes(lower);
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Members</h1>

      <form className="flex flex-wrap gap-2">
        <Input
          name="q"
          placeholder="Search by name or email…"
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
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No members found.
                </TableCell>
              </TableRow>
            ) : (
              members.map((m, i) => {
                const name = [m.profiles?.first_name, m.profiles?.last_name]
                  .filter(Boolean)
                  .join(" ") || "—";
                return (
                  <TableRow key={`${m.team_id}-${m.profiles?.id ?? i}`}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.profiles?.email ?? "—"}
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
