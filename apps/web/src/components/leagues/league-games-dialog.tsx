"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gameTitle } from "@/lib/events/game-display";
import { formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";
import { leagueErrorMessage, leagueLabel, type League } from "@/lib/leagues";

type Game = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  timezone: string | null;
  opponent: string | null;
  home_away: string | null;
  score_for: number | null;
  score_against: number | null;
  league_id: string | null;
};

const DAY = 24 * 60 * 60 * 1000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * "League games": the team's games in a date range, played ones included, ticked
 * to put them in this league or take them out (spec §5). A league added halfway
 * through a season gets its earlier results this way.
 *
 * Classification only, never the schedule: the database's change notices ignore
 * league_id, so saving tells nobody.
 */
export function LeagueGamesDialog({
  league,
  leagues,
  teamId,
  teamName,
  teamTimeZone,
  open,
  onOpenChange,
}: {
  league: League;
  leagues: League[];
  teamId: string;
  teamName: string;
  teamTimeZone?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [from, setFrom] = useState(() => dateOnly(new Date(Date.now() - 120 * DAY)));
  const [to, setTo] = useState(() => dateOnly(new Date(Date.now() + 240 * DAY)));
  const [games, setGames] = useState<Game[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !from || !to) return;
    let current = true;
    void (async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_type, start_time, timezone, opponent, home_away, score_for, score_against, league_id")
        .eq("team_id", teamId)
        .eq("event_type", "game")
        .gte("start_time", new Date(`${from}T00:00:00`).toISOString())
        .lt("start_time", new Date(Date.parse(`${to}T00:00:00`) + DAY).toISOString())
        .order("start_time", { ascending: true });
      if (!current) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      const rows = (data ?? []) as Game[];
      setGames(rows);
      setChecked(new Set(rows.filter((g) => g.league_id === league.id).map((g) => g.id)));
    })();
    return () => {
      current = false;
    };
  }, [open, from, to, supabase, teamId, league.id]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!games) return;
    const toSet = games.filter((g) => checked.has(g.id) && g.league_id !== league.id).map((g) => g.id);
    const toClear = games.filter((g) => !checked.has(g.id) && g.league_id === league.id).map((g) => g.id);
    setSaving(true);
    const results = await Promise.all([
      toSet.length > 0 ? supabase.from("events").update({ league_id: league.id }).in("id", toSet) : null,
      toClear.length > 0 ? supabase.from("events").update({ league_id: null }).in("id", toClear) : null,
    ]);
    setSaving(false);
    const failed = results.find((r) => r?.error);
    if (failed?.error) {
      toast.error(leagueErrorMessage(failed.error));
      return;
    }
    const changed = toSet.length + toClear.length;
    toast.success(changed === 0 ? "No changes" : `Updated ${changed} ${changed === 1 ? "game" : "games"}`);
    onOpenChange(false);
  }

  const other = (id: string | null) => (id && id !== league.id ? leagues.find((l) => l.id === id) : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>League games: {leagueLabel(league)}</DialogTitle>
          <DialogDescription>
            Tick the games in this league, played ones included. This only labels games: nobody is notified.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="league-games-from">From</Label>
            <Input id="league-games-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="league-games-to">To</Label>
            <Input id="league-games-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {games === null ? (
          <p className="text-sm text-muted-foreground">Loading games…</p>
        ) : games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No games in these dates.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {games.map((g) => {
              const zone = resolveTimeZone(g.timezone ?? teamTimeZone);
              const name = `${gameTitle(g, teamName)} · ${formatShortEventDate(g.start_time, zone)}`;
              const elsewhere = other(g.league_id);
              return (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked.has(g.id)}
                      onChange={() => toggle(g.id)}
                      aria-label={name}
                    />
                    <span>
                      <span className="block">{name}</span>
                      {elsewhere && (
                        <span className="block text-xs text-muted-foreground">In {leagueLabel(elsewhere)}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || games === null}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
