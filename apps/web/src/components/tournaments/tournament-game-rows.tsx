"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { uniformOf, type TeamDisplay } from "@/lib/events/game-display";
import { instantFromWallClock } from "@/lib/events/event-timezone";
import { isWithinDays, type TournamentGameDraft } from "@/lib/events/tournament-form";

// Wall-clock times ("YYYY-MM-DDTHH:mm") in the tournament's zone, never the browser's (BUG-010).
const wallMs = (wall: string) => Date.parse(`${wall}:00.000Z`);
const shiftWall = (wall: string, ms: number) => new Date(wallMs(wall) + ms).toISOString().slice(0, 16);
const HOUR = 60 * 60 * 1000;

/** A new game: an hour, after the last one, else 9 AM on the first day. */
export function newGameDraft(previous: TournamentGameDraft | undefined, firstDay: string): TournamentGameDraft {
  const start = previous?.end && wallMs(previous.end) ? previous.end : `${firstDay}T09:00`;
  return { start, end: shiftWall(start, HOUR), opponent: "", homeAway: "", uniform: "", round: "" };
}

const SELECT_CLASS =
  "border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * One game of a tournament being entered. Labelled "Game 1 start" and so on,
 * so each field names its row. Native selects: a list of rows of popovers is
 * hard to move through.
 */
export function TournamentGameRow({
  index,
  draft,
  onChange,
  onRemove,
  zone,
  firstDay,
  lastDay,
  team,
  error,
}: {
  index: number;
  /** Why this game can't be saved, shown on it (review TL-012). */
  error?: string | null;
  draft: TournamentGameDraft;
  onChange: (draft: TournamentGameDraft) => void;
  onRemove?: () => void;
  zone: string;
  firstDay: string;
  lastDay: string;
  team: TeamDisplay;
}) {
  const n = index + 1;
  const id = (field: string) => `game-${n}-${field}`;
  const set = (patch: Partial<TournamentGameDraft>) => onChange({ ...draft, ...patch });

  // Schedules slip, so a game outside the days is saved; the coach is told.
  const outside =
    !!draft.start &&
    !!wallMs(draft.start) &&
    firstDay <= lastDay &&
    !isWithinDays(instantFromWallClock(draft.start, zone), firstDay, lastDay, zone);

  return (
    <fieldset aria-label={`Game ${n}`} className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">Game {n}</legend>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove game ${n}`} onClick={onRemove}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("start")}>Start</Label>
          <Input
            id={id("start")}
            aria-label={`Game ${n} start`}
            type="datetime-local"
            step={300}
            value={draft.start}
            onChange={(e) => {
              const start = e.target.value;
              // Moving the start keeps the game's length.
              const end =
                start && draft.start && draft.end && wallMs(start)
                  ? shiftWall(start, wallMs(draft.end) - wallMs(draft.start))
                  : draft.end;
              set({ start, end });
            }}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("end")}>End</Label>
          <Input
            id={id("end")}
            aria-label={`Game ${n} end`}
            type="datetime-local"
            step={300}
            value={draft.end}
            onChange={(e) => set({ end: e.target.value })}
            required
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {outside && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This game is outside the tournament&apos;s days. It&apos;s saved anyway, in case the schedule slipped.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("opponent")}>Opponent</Label>
          <Input
            id={id("opponent")}
            aria-label={`Game ${n} opponent`}
            placeholder="TBD"
            value={draft.opponent}
            onChange={(e) => set({ opponent: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("round")}>Round</Label>
          <Input
            id={id("round")}
            aria-label={`Game ${n} round`}
            placeholder="e.g. Pool A, Semifinal"
            value={draft.round}
            onChange={(e) => set({ round: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("home-away")}>Home / Away</Label>
          <select
            id={id("home-away")}
            aria-label={`Game ${n} home or away`}
            className={SELECT_CLASS}
            value={draft.homeAway}
            onChange={(e) => set({ homeAway: e.target.value })}
          >
            <option value="">—</option>
            <option value="home">Home</option>
            <option value="away">Away</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("uniform")}>Uniform</Label>
          <select
            id={id("uniform")}
            aria-label={`Game ${n} uniform`}
            className={SELECT_CLASS}
            value={draft.uniform}
            onChange={(e) => set({ uniform: e.target.value })}
          >
            <option value="">—</option>
            <option value="home">{uniformOf("home", team)!.name}</option>
            <option value="away">{uniformOf("away", team)!.name}</option>
          </select>
        </div>
      </div>
    </fieldset>
  );
}

/** A tournament's games as it's created: any number, added and removed. */
export function TournamentGameRows({
  games,
  onChange,
  zone,
  firstDay,
  lastDay,
  team,
  errors = [],
}: {
  games: TournamentGameDraft[];
  /** Each game's error, by position. */
  errors?: (string | null)[];
  onChange: (games: TournamentGameDraft[]) => void;
  zone: string;
  firstDay: string;
  lastDay: string;
  team: TeamDisplay;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Games</h4>
        <p className="text-sm text-muted-foreground">
          Add the games you know of now. More can be added from the tournament&apos;s page.
        </p>
      </div>
      {games.map((draft, i) => (
        <TournamentGameRow
          key={i}
          index={i}
          draft={draft}
          onChange={(next) => onChange(games.map((g, j) => (j === i ? next : g)))}
          onRemove={() => onChange(games.filter((_, j) => j !== i))}
          zone={zone}
          firstDay={firstDay}
          lastDay={lastDay}
          team={team}
          error={errors[i]}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...games, newGameDraft(games[games.length - 1], firstDay)])}
      >
        Add a game
      </Button>
    </div>
  );
}
