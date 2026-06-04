"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Archive, ArchiveRestore, AlertTriangle } from "lucide-react";
import type { OrgPlan } from "@/lib/plan";

type Team = {
  id: string;
  name: string;
  season: string | null;
  created_at: string | null;
  archived_at: string | null;
  owner_id: string | null;
  memberCount: number;
};

/**
 * Spec: docs/specs/club-upgrade-monetization.md → "Over-Limit Downgrade".
 *
 * Returns the persistent warning banner copy when the org is over its
 * `team_limit`, or `null` when nothing should render. The copy is intentionally
 * verbatim from the spec; tests pin the exact strings.
 *
 * Counting semantics: `activeCount` is the number of NON-archived teams. The
 * route + RPC count the same way (20260521000000_create_club_team_active_count
 * + POST /api/club/teams) so "archive teams to stay on Free" / "Archive teams
 * or upgrade to Club Large" is an honest remedy — archiving genuinely frees a
 * slot.
 *
 * Why server-derived: the banner reads from the org's `plan` and `team_limit`
 * (both server-side), so the page passes both plus the precomputed
 * `activeTeamCount` rather than re-counting client-side.
 */
export function overLimitMessage(
  plan: OrgPlan | null,
  teamLimit: number | null,
  activeCount: number,
): string | null {
  if (teamLimit == null) return null;
  if (activeCount <= teamLimit) return null;
  if (plan === "free") {
    return `You have ${activeCount} teams but your Free plan allows ${teamLimit}. Upgrade to add more, or archive teams to stay on Free.`;
  }
  if (plan === "club_small") {
    return `You have ${activeCount} teams but Club Small allows ${teamLimit}. Archive teams or upgrade to Club Large to add more.`;
  }
  // club_large has team_limit=NULL so we never reach here with a club_large
  // plan; an unrecognised plan with a finite limit suppresses the banner
  // rather than rendering with a missing tier name.
  return null;
}

export function ClubTeamsClient({
  orgId,
  activeTeams,
  archivedTeams,
  showArchived,
  plan,
  teamLimit,
  activeTeamCount,
}: {
  orgId: string;
  teams: Team[];
  activeTeams: Team[];
  archivedTeams: Team[];
  showArchived: boolean;
  plan: OrgPlan | null;
  teamLimit: number | null;
  activeTeamCount: number;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [season, setSeason] = useState("");
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/club/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, teamName: teamName.trim(), season: season.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to create team");
        return;
      }
      toast.success("Team created");
      setCreateOpen(false);
      setTeamName("");
      setSeason("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive(teamId: string, archive: boolean) {
    setArchiving(teamId);
    try {
      const res = await fetch(`/api/club/teams/${teamId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to update team");
        return;
      }
      toast.success(archive ? "Team archived" : "Team restored");
      router.refresh();
    } finally {
      setArchiving(null);
    }
  }

  const visibleTeams = showArchived
    ? [...activeTeams, ...archivedTeams]
    : activeTeams;

  const overLimitBanner = overLimitMessage(plan, teamLimit, activeTeamCount);

  return (
    <div className="space-y-6">
      {overLimitBanner && (
        <div
          role="alert"
          data-testid="over-limit-banner"
          className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <span>{overLimitBanner}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams</h1>
        <div className="flex gap-2">
          <Link
            href={showArchived ? "/dashboard/club/teams" : "/dashboard/club/teams?archived=1"}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                New team
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a new team</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="teamName">Team name</Label>
                  <Input
                    id="teamName"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. U12 Blue"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="season">Season</Label>
                  <Input
                    id="season"
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    placeholder="e.g. Spring 2026"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={creating}>
                  {creating ? "Creating…" : "Create team"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTeams.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No teams yet. Create your first team above.
                </TableCell>
              </TableRow>
            ) : (
              visibleTeams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.season ?? "—"}
                  </TableCell>
                  <TableCell>{t.memberCount}</TableCell>
                  <TableCell>
                    {t.archived_at ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={archiving === t.id}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {t.archived_at ? (
                          <DropdownMenuItem
                            onClick={() => handleArchive(t.id, false)}
                          >
                            <ArchiveRestore className="mr-2 h-4 w-4" />
                            Restore team
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleArchive(t.id, true)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive team
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
