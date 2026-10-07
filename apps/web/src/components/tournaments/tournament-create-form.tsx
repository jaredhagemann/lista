"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { TimeZoneSelect } from "@/components/calendar/time-zone-select";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import type { TeamDisplay } from "@/lib/events/game-display";
import {
  gameTimesError,
  tournamentErrorMessage,
  tournamentGamesPayload,
  type TournamentGameDraft,
} from "@/lib/events/tournament-form";
import { LocationField, noLocation, resolveLocation } from "./location-field";
import { TournamentGameRows } from "./tournament-game-rows";

const DAYS_ERROR = "The last day can't be before the first.";

/**
 * A new tournament and its games, saved in one call with one notice
 * (docs/specs/tournaments-and-leagues.md §4, "Web" and "Notifications").
 *
 * Whole days in its zone (D13), and never recurring (D18), so it has no times
 * and no repeat switch. `typeField` is the create dialog's own type select, so
 * the coach can switch back to another kind of event.
 */
export function TournamentCreateForm({
  teamId,
  team,
  timeZone,
  onTimeZoneChange,
  teamTimeZone,
  defaultDay,
  typeField,
  onClose,
}: {
  teamId: string;
  team: TeamDisplay;
  timeZone: string;
  onTimeZoneChange: (zone: string) => void;
  teamTimeZone?: string | null;
  defaultDay: string;
  typeField: ReactNode;
  onClose: () => void;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [title, setTitle] = useState("");
  const [firstDay, setFirstDay] = useState(defaultDay);
  const [lastDay, setLastDay] = useState(defaultDay);
  const [location, setLocation] = useState(noLocation());
  const [notes, setNotes] = useState("");
  const [games, setGames] = useState<TournamentGameDraft[]>([]);
  // D3: a new event notifies unless the coach says otherwise.
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [daysError, setDaysError] = useState(false);
  const [gameErrors, setGameErrors] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Checked before anything is written, a new location included (TL-012).
    const errors = games.map(gameTimesError);
    setGameErrors(errors);
    setDaysError(lastDay < firstDay);
    if (lastDay < firstDay || errors.some(Boolean)) return;
    setSaving(true);

    const resolved = await resolveLocation(supabase, teamId, location);
    if ("error" in resolved) {
      toast.error(resolved.error);
      setSaving(false);
      return;
    }

    const { error } = await supabase.rpc("create_tournament", {
      p_team_id: teamId,
      p_title: title.trim(),
      p_first_day: firstDay,
      p_last_day: lastDay,
      p_timezone: timeZone,
      // The generated types say `string | undefined`; null is what's meant.
      p_location_id: resolved.id as string,
      p_notes: (notes.trim() || null) as string,
      // Each game at the tournament's location: the form has no venue per game (TL-013).
      p_games: tournamentGamesPayload(games, timeZone, team.name, resolved.id),
      p_notify: notifyTeam,
    });
    if (error) {
      toast.error(tournamentErrorMessage(error));
      setSaving(false);
      return;
    }

    // create_tournament queued its one notice; send it now.
    const summary = notifyTeam ? await drainNotifications() : null;
    toast.success(withNotice("Tournament created", summary));
    setSaving(false);
    router.refresh();
    onClose();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tournamentName">Name</Label>
          <Input
            id="tournamentName"
            placeholder="e.g. Surf Cup"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        {typeField}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstDay">First day</Label>
            <Input
              id="firstDay"
              type="date"
              value={firstDay}
              onChange={(e) => {
                const day = e.target.value;
                setFirstDay(day);
                // A tournament that would end before it starts now ends that day.
                if (day && lastDay < day) setLastDay(day);
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastDay">Last day</Label>
            <Input id="lastDay" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
          </div>
        </div>
        {daysError && <p className="text-sm text-destructive">{DAYS_ERROR}</p>}

        <TimeZoneSelect value={timeZone} onChange={onTimeZoneChange} teamTimeZone={teamTimeZone} />

        <LocationField teamId={teamId} value={location} onChange={setLocation} />

        <div className="space-y-2">
          <Label htmlFor="tournamentNotes">Notes</Label>
          <Textarea
            id="tournamentNotes"
            placeholder="Check-in, parking, schedule link…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <TournamentGameRows
          games={games}
          onChange={(next) => {
            setGames(next);
            // Positions shift when a game is removed; errors are checked again on save.
            setGameErrors([]);
          }}
          errors={gameErrors}
          zone={timeZone}
          firstDay={firstDay}
          lastDay={lastDay}
          team={team}
        />

        <div className="flex items-center justify-between">
          <div>
            <Label>Notify the team</Label>
            <p className="text-sm text-muted-foreground">One email and push about the tournament and its games</p>
          </div>
          <Switch checked={notifyTeam} onCheckedChange={setNotifyTeam} aria-label="Notify the team" />
        </div>
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create tournament"}
        </Button>
      </DialogFooter>
    </form>
  );
}
