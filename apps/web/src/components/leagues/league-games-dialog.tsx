"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gameTitle } from "@/lib/events/game-display";
import { wallClockIn } from "@/lib/events/event-timezone";
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
 * The games of a load, and the exact range and attempt it answers. A load
 * answers one range: ticks never outlive it (review TL-025).
 */
type Loaded = { key: string; status: "loaded" | "failed"; games: Game[] };

/**
 * "League games": the team's games in a date range, played ones included, ticked
 * to put them in this league or take them out (spec §5). A league added halfway
 * through a season gets its earlier results this way.
 *
 * - **Dates (TL-024):** a game is in the range when its own date, as shown
 *   beside it (in its zone, else the team's), is. The read covers a day either
 *   side, so no zone's games are cut off, then each is kept by its own date:
 *   never by the browser's zone, and never by a fixed 24-hour day.
 * - **Ticks (TL-025):** they belong to the dates they were read for. Changing
 *   the dates reads again and starts from what's saved; Save waits for a good
 *   read of the dates shown.
 * - **Saving (TL-023):** untagging only clears a game still in this league, so
 *   one another coach has moved meanwhile stays where they put it.
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
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const validRange = !!from && !!to && from <= to;
  const requestKey = `${from}|${to}|${attempt}`;
  // What's on screen is the read of the dates shown, and it worked.
  const current = loaded?.key === requestKey ? loaded : null;
  const games = current?.status === "loaded" ? current.games : null;

  useEffect(() => {
    if (!open || !validRange) return;
    let live = true;
    const key = requestKey;
    // A day either side of the range, as instants: no game's own date in the
    // range falls outside it, whatever its zone. Kept by its own date below.
    const start = new Date(Date.parse(`${from}T00:00:00Z`) - DAY).toISOString();
    const end = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY).toISOString();
    void supabase
      .from("events")
      .select("id, title, event_type, start_time, timezone, opponent, home_away, score_for, score_against, league_id")
      .eq("team_id", teamId)
      .eq("event_type", "game")
      .gte("start_time", start)
      .lt("start_time", end)
      .order("start_time", { ascending: true })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          toast.error(`Couldn't load the games: ${error.message}`);
          setLoaded({ key, status: "failed", games: [] });
          return;
        }
        const inRange = ((data ?? []) as Game[]).filter((g) => {
          const day = wallClockIn(g.start_time, resolveTimeZone(g.timezone ?? teamTimeZone)).slice(0, 10);
          return day >= from && day <= to;
        });
        setLoaded({ key, status: "loaded", games: inRange });
        setChecked(new Set(inRange.filter((g) => g.league_id === league.id).map((g) => g.id)));
      });
    return () => {
      live = false;
    };
  }, [open, validRange, requestKey, from, to, supabase, teamId, league.id, teamTimeZone]);

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
    const [setResult, clearResult] = await Promise.all([
      toSet.length > 0 ? supabase.from("events").update({ league_id: league.id }).in("id", toSet).select("id") : null,
      // Only games still in this league (TL-023): a game moved to another
      // league since this was read stays there.
      toClear.length > 0
        ? supabase.from("events").update({ league_id: null }).in("id", toClear).eq("league_id", league.id).select("id")
        : null,
    ]);
    setSaving(false);
    const failed = [setResult, clearResult].find((r) => r?.error);
    if (failed?.error) {
      toast.error(leagueErrorMessage(failed.error));
      return;
    }
    // What really changed, from the rows the database returned.
    const set = setResult?.data?.length ?? 0;
    const cleared = clearResult?.data?.length ?? 0;
    const changed = set + cleared;
    const movedAway = toClear.length - cleared;
    toast.success(changed === 0 ? "No changes" : `Updated ${changed} ${changed === 1 ? "game" : "games"}`);
    if (movedAway > 0) {
      toast.info(
        `${movedAway} ${movedAway === 1 ? "game had" : "games had"} moved to another league since you opened this, so ${
          movedAway === 1 ? "it was" : "they were"
        } left there.`
      );
    }
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
        <p className="text-xs text-muted-foreground">
          By each game&apos;s own date, as shown beside it. Changing the dates starts again from what&apos;s saved.
        </p>
        {!validRange ? (
          <p className="text-sm text-destructive">
            {from && to ? "The From date is after the To date." : "Choose both dates."}
          </p>
        ) : current?.status === "failed" ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Couldn&apos;t load the games.</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </Button>
          </div>
        ) : games === null ? (
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
          <Button onClick={save} disabled={saving || !validRange || games === null}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
