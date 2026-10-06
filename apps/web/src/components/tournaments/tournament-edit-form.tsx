"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { TimeZoneSelect } from "@/components/calendar/time-zone-select";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import { formatShortEventDate } from "@/lib/notifications/event-time";
import { gameTitle } from "@/lib/events/game-display";
import {
  gamesOutsideDays,
  tournamentBounds,
  tournamentDays,
  tournamentErrorMessage,
} from "@/lib/events/tournament-form";
import type { Database } from "@/types/database";
import { LocationField, noLocation, resolveLocation } from "./location-field";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Game = Pick<Event, "id" | "title" | "event_type" | "start_time" | "opponent" | "home_away" | "round" | "is_cancelled">;

const DAYS_ERROR = "The last day can't be before the first.";

/**
 * A tournament's own fields: name, days, zone, location, notes and placement.
 *
 * New days never move its games (§4, "Cancelling and rescheduling"): the form
 * lists any now outside them, so the coach can move them. Its type and team
 * never change here, so its games stay valid.
 */
export function TournamentEditForm({
  tournament,
  zone,
  games,
  teamName,
  teamTimeZone,
  onSave,
  onCancel,
}: {
  tournament: Event;
  /** The zone it's in now: its own, or the team's for one without. */
  zone: string;
  games: Game[];
  teamName: string;
  teamTimeZone?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const original = tournamentDays(tournament, zone);

  const [title, setTitle] = useState(tournament.title);
  const [firstDay, setFirstDay] = useState(original.firstDay);
  const [lastDay, setLastDay] = useState(original.lastDay);
  const [timeZone, setTimeZone] = useState(zone);
  const [location, setLocation] = useState(noLocation(tournament.location_id ?? ""));
  const [notes, setNotes] = useState(tournament.notes ?? "");
  const [place, setPlace] = useState(tournament.placement_rank?.toString() ?? "");
  const [placementLabel, setPlacementLabel] = useState(tournament.placement_label ?? "");
  // As for any event (D3): days and location notify by themselves; a name or
  // notes edit only when asked. A placement never does.
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [daysError, setDaysError] = useState(false);
  const [saving, setSaving] = useState(false);

  const [upcoming] = useState(() => Date.parse(tournament.end_time) > Date.now());
  const outside = firstDay && lastDay && firstDay <= lastDay ? gamesOutsideDays(games, firstDay, lastDay, timeZone) : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lastDay < firstDay) {
      setDaysError(true);
      return;
    }
    setDaysError(false);
    setSaving(true);

    const resolved = await resolveLocation(supabase, tournament.team_id!, location);
    if ("error" in resolved) {
      toast.error(resolved.error);
      setSaving(false);
      return;
    }

    // Untouched days keep their stored instants, whatever the zone rules did since.
    const daysChanged = firstDay !== original.firstDay || lastDay !== original.lastDay || timeZone !== zone;
    const bounds = daysChanged
      ? tournamentBounds(firstDay, lastDay, timeZone)
      : { start_time: tournament.start_time, end_time: tournament.end_time };
    const rank = place.trim() === "" ? null : parseInt(place, 10);

    const row = {
      title: title.trim(),
      ...bounds,
      timezone: timeZone,
      location_id: resolved.id,
      notes: notes.trim() || null,
      placement_rank: rank != null && Number.isFinite(rank) ? rank : null,
      placement_label: placementLabel.trim() || null,
    };

    const { error } = await supabase.from("events").update(row).eq("id", tournament.id);
    if (error) {
      toast.error(tournamentErrorMessage(error));
      setSaving(false);
      return;
    }

    const schedulingChanged =
      Date.parse(row.start_time) !== Date.parse(tournament.start_time) ||
      Date.parse(row.end_time) !== Date.parse(tournament.end_time) ||
      row.location_id !== tournament.location_id;

    // Only what the switch is for: a name or notes change. A placement, or a
    // save with nothing changed, stays silent (review TL-014).
    const describedChanged = row.title !== tournament.title || row.notes !== (tournament.notes ?? null);
    const askedNotice = notifyTeam && describedChanged && upcoming && !tournament.is_cancelled;

    if (!schedulingChanged && askedNotice) {
      const { error: queueError } = await supabase.rpc("enqueue_event_notification", {
        p_event_id: tournament.id,
        p_action: "updated",
      });
      if (queueError) {
        toast.error(`Tournament saved, but the notification could not be queued: ${queueError.message}`);
      }
    }

    const summary = schedulingChanged || askedNotice ? await drainNotifications() : null;
    toast.success(withNotice("Tournament updated", summary));
    setSaving(false);
    onSave();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit tournament</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tournamentName">Name</Label>
            <Input id="tournamentName" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstDay">First day</Label>
              <Input id="firstDay" type="date" value={firstDay} onChange={(e) => setFirstDay(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastDay">Last day</Label>
              <Input id="lastDay" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
            </div>
          </div>
          {daysError && <p className="text-sm text-destructive">{DAYS_ERROR}</p>}

          {outside.length > 0 && (
            <div
              role="status"
              aria-label="Games outside the tournament's days"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
            >
              <p className="font-medium">
                {outside.length === 1 ? "A game is" : `${outside.length} games are`} outside these days. Changing the
                days doesn&apos;t move games, so you may want to move{" "}
                {outside.length === 1 ? "it" : "them"} from {outside.length === 1 ? "its" : "their"} own page:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {outside.map((g) => (
                  <li key={g.id}>
                    {[gameTitle(g, teamName, { includeScore: false }), g.round?.trim(), formatShortEventDate(g.start_time, timeZone)]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TimeZoneSelect id="tournamentZone" value={timeZone} onChange={setTimeZone} teamTimeZone={teamTimeZone} />

          <LocationField teamId={tournament.team_id!} value={location} onChange={setLocation} />

          <div className="space-y-2">
            <Label htmlFor="tournamentNotes">Notes</Label>
            <Textarea id="tournamentNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div>
              <h4 className="text-sm font-medium">Placement</h4>
              <p className="text-sm text-muted-foreground">
                How the team finished. A label, if given, is shown instead of the place.
              </p>
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <div className="space-y-2">
                <Label htmlFor="placementRank">Place</Label>
                <Input
                  id="placementRank"
                  type="number"
                  min="1"
                  placeholder="e.g. 2"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="placementLabel">Placement label</Label>
                <Input
                  id="placementLabel"
                  placeholder="e.g. Gold bracket champions"
                  value={placementLabel}
                  onChange={(e) => setPlacementLabel(e.target.value)}
                />
              </div>
            </div>
          </div>

          {upcoming && !tournament.is_cancelled && (
            <div className="flex items-center justify-between">
              <div>
                <Label>Notify the team</Label>
                <p className="text-sm text-muted-foreground">
                  Changes to its days or location always notify. Turn this on to send a name or notes change too.
                </p>
              </div>
              <Switch checked={notifyTeam} onCheckedChange={setNotifyTeam} aria-label="Notify the team" />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save tournament"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
