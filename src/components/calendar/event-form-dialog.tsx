"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { buildRRule, expandRecurrenceFromLocalString } from "@/lib/utils/rrule";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];

function toLocalDatetime(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function EventFormDialog({
  open,
  onClose,
  teamId,
  defaultStart,
  defaultEnd,
  editingEvent,
  homeUniform,
  awayUniform,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  defaultStart?: Date;
  defaultEnd?: Date;
  editingEvent?: Event | null;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const isEditing = !!editingEvent;
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState(editingEvent?.title ?? "");
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    (editingEvent?.event_type as "practice" | "game" | "other") ?? "practice"
  );
  const [locationId, setLocationId] = useState(
    editingEvent?.location_id ?? ""
  );
  const [notes, setNotes] = useState(editingEvent?.notes ?? "");
  const [startTime, setStartTime] = useState(
    editingEvent
      ? toLocalDatetime(new Date(editingEvent.start_time))
      : defaultStart
        ? toLocalDatetime(defaultStart)
        : ""
  );
  const [endTime, setEndTime] = useState(
    editingEvent
      ? toLocalDatetime(new Date(editingEvent.end_time))
      : defaultEnd
        ? toLocalDatetime(
            new Date(
              defaultEnd.getTime() === defaultStart?.getTime()
                ? defaultStart.getTime() + 90 * 60 * 1000
                : defaultEnd.getTime()
            )
          )
        : ""
  );

  // Game-specific fields
  const [opponent, setOpponent] = useState(editingEvent?.opponent ?? "");
  const [homeAway, setHomeAway] = useState(editingEvent?.home_away ?? "");
  const [uniform, setUniform] = useState(editingEvent?.uniform ?? "");
  const [gameResult, setGameResult] = useState(editingEvent?.game_result ?? "");
  const [scoreFor, setScoreFor] = useState(
    editingEvent?.score_for?.toString() ?? ""
  );
  const [scoreAgainst, setScoreAgainst] = useState(
    editingEvent?.score_against?.toString() ?? ""
  );

  // Locations
  const [locations, setLocations] = useState<Location[]>([]);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");

  // Recurring event settings
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly">("weekly");
  const [recurUntil, setRecurUntil] = useState("");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchLocations() {
      const { data } = await supabase
        .from("locations")
        .select("*")
        .eq("team_id", teamId)
        .order("name");
      if (data) setLocations(data);
    }
    fetchLocations();
  }, [teamId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("You must be signed in.");
      setLoading(false);
      return;
    }

    // Handle new location creation
    let resolvedLocationId = locationId || null;
    if (showNewLocation && newLocationName.trim()) {
      const newLocId = crypto.randomUUID();
      const { error: locError } = await supabase.from("locations").insert({
        id: newLocId,
        team_id: teamId,
        name: newLocationName.trim(),
        address: newLocationAddress.trim() || null,
      });
      if (locError) {
        toast.error(`Failed to create location: ${locError.message}`);
        setLoading(false);
        return;
      }
      resolvedLocationId = newLocId;
    }

    const eventData = {
      team_id: teamId,
      title,
      event_type: eventType,
      location_id: resolvedLocationId,
      notes: notes || null,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      created_by: user.id,
      // Game-specific fields (null when not a game)
      opponent: eventType === "game" ? opponent || null : null,
      home_away: eventType === "game" ? homeAway || null : null,
      uniform: eventType === "game" ? uniform || null : null,
      game_result:
        eventType === "game" && isEditing ? gameResult || null : null,
      score_for:
        eventType === "game" && isEditing && scoreFor !== ""
          ? parseInt(scoreFor, 10)
          : null,
      score_against:
        eventType === "game" && isEditing && scoreAgainst !== ""
          ? parseInt(scoreAgainst, 10)
          : null,
    };

    if (isEditing && editingEvent) {
      const { error } = await supabase
        .from("events")
        .update(eventData)
        .eq("id", editingEvent.id);

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      toast.success("Event updated");
    } else if (isRecurring && recurUntil) {
      // Create parent event with RRULE
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const durationMs = endDate.getTime() - startDate.getTime();

      const rruleString = buildRRule({
        frequency,
        daysOfWeek: [startDate.getDay() === 0 ? 6 : startDate.getDay() - 1],
        until: new Date(recurUntil),
      });

      const { data: rawParentEvent, error: parentError } = await supabase
        .from("events")
        .insert({
          ...eventData,
          recurrence_rule: rruleString,
        })
        .select()
        .single();

      const parentEvent = rawParentEvent as Event;

      if (parentError) {
        toast.error(parentError.message);
        setLoading(false);
        return;
      }

      // Expand recurrence and create child events.
      // Uses startTime (the raw datetime-local string) so that rrule's UTC arithmetic
      // aligns with wall-clock intent — avoids the day-shift bug for afternoon events
      // in western timezones (e.g. 4 PM PST = midnight UTC = wrong day for rrule).
      const occurrences = expandRecurrenceFromLocalString(startTime, rruleString);

      // Skip the first one (it's the parent event itself)
      // Exclude game_result/score fields from child events
      const childEvents = occurrences.slice(1).map((date) => ({
        ...eventData,
        game_result: null,
        score_for: null,
        score_against: null,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent.id,
      }));

      if (childEvents.length > 0) {
        const { error: childError } = await supabase
          .from("events")
          .insert(childEvents);

        if (childError) {
          toast.error(childError.message);
          setLoading(false);
          return;
        }
      }

      toast.success(
        `Created recurring event with ${childEvents.length + 1} occurrences`
      );
    } else {
      const { error } = await supabase.from("events").insert(eventData);

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      toast.success("Event created");
    }

    setLoading(false);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit event" : "Create event"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g. Tuesday Practice"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventType">Type</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as "practice" | "game" | "other")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="practice">Practice</SelectItem>
                  <SelectItem value="game">Game</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Location</Label>
              {!showNewLocation ? (
                <Select
                  value={locationId}
                  onValueChange={(v) => {
                    if (v === "__new__") {
                      setShowNewLocation(true);
                      setLocationId("");
                    } else {
                      setLocationId(v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Add new location</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <Input
                    placeholder="Location name"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                  />
                  <Input
                    placeholder="Address (optional)"
                    value={newLocationAddress}
                    onChange={(e) => setNewLocationAddress(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowNewLocation(false);
                      setNewLocationName("");
                      setNewLocationAddress("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Start</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any additional details..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            {eventType === "game" && (
              <div className="space-y-4 rounded-md border p-4">
                <h4 className="text-sm font-medium">Game details</h4>
                <div className="space-y-2">
                  <Label htmlFor="opponent">Opponent</Label>
                  <Input
                    id="opponent"
                    placeholder="e.g. Rival FC"
                    value={opponent}
                    onChange={(e) => setOpponent(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Home / Away</Label>
                    <Select value={homeAway} onValueChange={setHomeAway}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home">Home</SelectItem>
                        <SelectItem value="away">Away</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Uniform</Label>
                    <Select value={uniform} onValueChange={setUniform}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home">
                          {homeUniform || "Home"}
                        </SelectItem>
                        <SelectItem value="away">
                          {awayUniform || "Away"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {isEditing && (
                  <>
                    <div className="space-y-2">
                      <Label>Result</Label>
                      <Select value={gameResult} onValueChange={setGameResult}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select result" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="win">Win</SelectItem>
                          <SelectItem value="loss">Loss</SelectItem>
                          <SelectItem value="tie">Tie</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="scoreFor">Score (us)</Label>
                        <Input
                          id="scoreFor"
                          type="number"
                          min="0"
                          value={scoreFor}
                          onChange={(e) => setScoreFor(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scoreAgainst">Score (them)</Label>
                        <Input
                          id="scoreAgainst"
                          type="number"
                          min="0"
                          value={scoreAgainst}
                          onChange={(e) => setScoreAgainst(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {!isEditing && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Recurring event</Label>
                    <p className="text-sm text-muted-foreground">
                      Repeat this event on a schedule
                    </p>
                  </div>
                  <Switch
                    checked={isRecurring}
                    onCheckedChange={setIsRecurring}
                  />
                </div>

                {isRecurring && (
                  <div className="space-y-4 rounded-md border p-4">
                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Select
                        value={frequency}
                        onValueChange={(v) =>
                          setFrequency(v as "weekly" | "biweekly")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recurUntil">Repeat until</Label>
                      <Input
                        id="recurUntil"
                        type="date"
                        value={recurUntil}
                        onChange={(e) => setRecurUntil(e.target.value)}
                        required={isRecurring}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save changes"
                  : "Create event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
