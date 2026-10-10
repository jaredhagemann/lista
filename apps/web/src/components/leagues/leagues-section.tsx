"use client";

import { useState } from "react";
import { Archive, ListChecks, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { activeLeagues, leagueErrorMessage, normalizeLeagueText, type League } from "@/lib/leagues";
import { useTeamLeagues } from "./use-team-leagues";
import { LeagueGamesDialog } from "./league-games-dialog";

/**
 * The team's leagues, in team settings, for coaches and managers
 * (docs/specs/tournaments-and-leagues.md §5; D17, D20, D21).
 *
 * A league is one season's. Archiving hides it from pickers and the Record card
 * and keeps its games' tags, so its record stays. One with games can't be
 * deleted: archive it instead.
 */
export function LeaguesSection({
  teamId,
  teamName,
  defaultSeason,
  teamTimeZone,
}: {
  teamId: string;
  teamName: string;
  /** The team's season, a new league's to start from. */
  defaultSeason: string;
  teamTimeZone?: string | null;
}) {
  const [supabase] = useState(() => createClient());
  const { leagues, create, setLeagues } = useTeamLeagues(teamId);
  const [name, setName] = useState("");
  const [season, setSeason] = useState(defaultSeason);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<League | null>(null);
  const [deleting, setDeleting] = useState<League | null>(null);
  const [tagging, setTagging] = useState<League | null>(null);

  const active = activeLeagues(leagues);
  const archived = leagues.filter((l) => l.archived_at);

  function replace(id: string, patch: Partial<League>) {
    setLeagues((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !season.trim()) return;
    setAdding(true);
    const created = await create(name, season);
    setAdding(false);
    if (created) {
      setName("");
      toast.success(`Added ${created.name}`);
    }
  }

  async function update(league: League, patch: Partial<League>, done: string) {
    const { error } = await supabase.from("leagues").update(patch).eq("id", league.id);
    if (error) {
      toast.error(leagueErrorMessage(error));
      return false;
    }
    replace(league.id, patch);
    toast.success(done);
    return true;
  }

  async function remove(league: League) {
    const { error } = await supabase.from("leagues").delete().eq("id", league.id);
    setDeleting(null);
    if (error) {
      toast.error(leagueErrorMessage(error));
      return;
    }
    setLeagues((prev) => prev.filter((l) => l.id !== league.id));
    toast.success(`Deleted ${league.name}`);
  }

  const row = (l: League, actions: React.ReactNode) => (
    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0">
        <span className="font-medium">{l.name}</span> <span className="text-muted-foreground">{l.season}</span>
      </span>
      <span className="flex gap-1">{actions}</span>
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leagues</CardTitle>
        <p className="text-sm text-muted-foreground">
          One per season. Tag games with a league to show its record beside the team&apos;s overall record.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leagues yet.</p>
        ) : (
          <ul aria-label="Active leagues" className="divide-y rounded-md border text-sm">
            {active.map((l) =>
              row(
                l,
                <>
                  <Button variant="outline" size="sm" aria-label={`League games for ${l.name}`} onClick={() => setTagging(l)}>
                    <ListChecks className="mr-1 h-4 w-4" /> League games
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Archive ${l.name}`}
                    onClick={() => update(l, { archived_at: new Date().toISOString() }, `Archived ${l.name}`)}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )
            )}
          </ul>
        )}

        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Archived</p>
            <ul aria-label="Archived leagues" className="divide-y rounded-md border text-sm text-muted-foreground">
              {archived.map((l) =>
                row(
                  l,
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Restore ${l.name}`}
                      onClick={() => update(l, { archived_at: null }, `Restored ${l.name}`)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )
              )}
            </ul>
          </div>
        )}

        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="league-name">League name</Label>
            <Input id="league-name" placeholder="e.g. Division 3" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="league-season">Season</Label>
            <Input id="league-season" placeholder="e.g. Fall 2026" value={season} onChange={(e) => setSeason(e.target.value)} />
          </div>
          <Button type="submit" disabled={adding || !name.trim() || !season.trim()}>
            Add league
          </Button>
        </form>
      </CardContent>

      {editing && (
        <EditLeagueDialog
          league={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (await update(editing, patch, "League updated")) setEditing(null);
          }}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A league with games can&apos;t be deleted; archive it instead, which keeps its record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <Button variant="destructive" onClick={() => deleting && remove(deleting)}>
              Delete league
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {tagging && (
        <LeagueGamesDialog
          league={tagging}
          leagues={leagues}
          teamId={teamId}
          teamName={teamName}
          teamTimeZone={teamTimeZone}
          open
          onOpenChange={(open) => !open && setTagging(null)}
        />
      )}
    </Card>
  );
}

function EditLeagueDialog({
  league,
  onClose,
  onSave,
}: {
  league: League;
  onClose: () => void;
  onSave: (patch: { name: string; season: string }) => void;
}) {
  const [name, setName] = useState(league.name);
  const [season, setSeason] = useState(league.season);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit league</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && season.trim()) {
              onSave({ name: normalizeLeagueText(name), season: normalizeLeagueText(season) });
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="edit-league-name">Name</Label>
            <Input id="edit-league-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-league-season">Season</Label>
            <Input id="edit-league-season" value={season} onChange={(e) => setSeason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !season.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
