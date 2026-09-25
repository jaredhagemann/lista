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
import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";
import { expandInZone, instantFromWallClock, isUsableTimeZone, wallClockIn } from "@/lib/events/event-timezone";
import { browserTimeZone } from "@/lib/events/team-timezone";
import { TimeZoneSelect } from "./time-zone-select";
import { GameTitleHint } from "@/components/events/game-title-hint";
import { UniformOptions } from "@/components/events/uniform-options";
import type { TeamDisplay } from "@/lib/events/game-display";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Start and end are wall-clock times ("YYYY-MM-DDTHH:mm") in the event's zone,
 * never the browser's (BUG-010, D5): the coach may be anywhere.
 */
const wallMs = (wall: string) => Date.parse(`${wall}:00.000Z`);
const shiftWall = (wall: string, ms: number) => new Date(wallMs(wall) + ms).toISOString().slice(0, 16);

/** rrule weekday (0 = Monday) of a wall-clock date. */
function wallRRuleDay(wall: string): number {
  const jsDay = new Date(`${wall.slice(0, 10)}T00:00:00.000Z`).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function EventFormDialog({
  open,
  onClose,
  teamId,
  teamTimeZone,
  defaultDate,
  team,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  /** The team's zone: a new event's default. */
  teamTimeZone?: string | null;
  /** The day to start on ("YYYY-MM-DD"), in the event's zone. */
  defaultDate?: string;
  /** Names games and their uniforms (spec: game-display-and-uniform-colors). */
  team: TeamDisplay;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    "practice"
  );
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  // The team's zone by default; the coach's own when the team has none yet.
  const [timeZone, setTimeZone] = useState(() =>
    isUsableTimeZone(teamTimeZone) ? teamTimeZone : browserTimeZone() ?? "UTC"
  );
  const defaultDay = defaultDate ?? wallClockIn(new Date(), timeZone).slice(0, 10);

  const [startTime, setStartTime] = useState(`${defaultDay}T12:00`);
  const [endTime, setEndTime] = useState(`${defaultDay}T13:00`);

  function handleStartTimeChange(newStart: string) {
    if (newStart && startTime && endTime) {
      setEndTime(shiftWall(newStart, wallMs(endTime) - wallMs(startTime)));
    }
    if (frequencyMode === "custom" && newStart) {
      const rruleDay = wallRRuleDay(newStart);
      setCustomDays((prev) =>
        prev.includes(rruleDay) ? prev : [...prev, rruleDay]
      );
    }
    setStartTime(newStart);
  }

  // Game-specific fields
  const [opponent, setOpponent] = useState("");
  const [homeAway, setHomeAway] = useState("");
  const [uniform, setUniform] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");

  // Locations
  const [locations, setLocations] = useState<Location[]>([]);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  // D3: a new event notifies unless the coach says otherwise.
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [frequencyMode, setFrequencyMode] = useState<
    "weekly" | "biweekly" | "custom"
  >("weekly");
  const [customInterval, setCustomInterval] = useState<"weekly" | "biweekly">(
    "weekly"
  );
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [recurUntil, setRecurUntil] = useState("");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("locations")
      .select("*")
      .eq("team_id", teamId)
      .order("name")
      .then(({ data }) => {
        if (data) setLocations(data);
      });
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
      start_time: instantFromWallClock(startTime, timeZone).toISOString(),
      end_time: instantFromWallClock(endTime, timeZone).toISOString(),
      timezone: timeZone,
      created_by: user.id,
      opponent: eventType === "game" ? opponent || null : null,
      home_away: eventType === "game" ? homeAway || null : null,
      uniform: eventType === "game" ? uniform || null : null,
      game_result: null,
      score_for: null,
      score_against: null,
      arrival_time: arrivalTime !== "" ? parseInt(arrivalTime, 10) : null,
    };

    if (isRecurring && recurUntil) {
      const durationMs = wallMs(endTime) - wallMs(startTime);
      const startDayRRule = wallRRuleDay(startTime);

      const daysOfWeek =
        frequencyMode === "custom"
          ? [...new Set([startDayRRule, ...customDays])]
          : [startDayRRule];

      const rruleString = buildRRule({
        frequency:
          frequencyMode === "custom"
            ? customInterval
            : (frequencyMode as "weekly" | "biweekly"),
        daysOfWeek,
        // "Repeat until" includes that day; the pattern start is stored with the rule.
        until: untilEndOfDay(recurUntil),
        dtstart: new Date(`${startTime}:00.000Z`),
        tzid: timeZone,
      });

      const { data: rawParentEvent, error: parentError } = await supabase
        .from("events")
        .insert({ ...eventData, recurrence_rule: rruleString })
        .select()
        .single();

      const parentEvent = rawParentEvent as Event;

      if (parentError) {
        toast.error(parentError.message);
        setLoading(false);
        return;
      }

      // Each occurrence keeps the local start time in the event's zone, across DST.
      const occurrences = expandInZone(startTime, rruleString, timeZone);
      const childEvents = occurrences.slice(1).map((date) => ({
        ...eventData,
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
        withNotice(
          `Created recurring event with ${childEvents.length + 1} occurrences`,
          await announce(parentEvent.id)
        )
      );
    } else {
      // The id is generated here so the creation notice can name the event.
      const eventId = crypto.randomUUID();
      const { error } = await supabase.from("events").insert({ ...eventData, id: eventId });
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      toast.success(withNotice("Event created", await announce(eventId)));
    }

    setLoading(false);
    router.refresh();
    onClose();
  }

  /**
   * Queues the creation notice, if the coach left the switch on, and sends what
   * is waiting. A series enqueues once for the whole operation.
   */
  async function announce(eventId: string) {
    if (!notifyTeam) return null;
    const { error } = await supabase.rpc("enqueue_event_notification", {
      p_event_id: eventId,
      p_action: "created",
    });
    if (error) {
      toast.error(`Event saved, but the notification could not be queued: ${error.message}`);
      return null;
    }
    return drainNotifications();
  }

  const startDayRRule = wallRRuleDay(startTime);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create event</DialogTitle>
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
              <GameTitleHint
                eventType={eventType}
                title={title}
                opponent={opponent}
                homeAway={homeAway}
                teamName={team.name}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventType">Type</Label>
              <Select
                value={eventType}
                onValueChange={(v) =>
                  setEventType(v as "practice" | "game" | "other")
                }
              >
                <SelectTrigger id="eventType">
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

            <div className="space-y-2">
              <Label htmlFor="arrivalTime">Arrival time</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="arrivalTime"
                  type="number"
                  min="0"
                  placeholder="e.g. 15"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  minutes before start
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Start</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  step={300}
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  step={300}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <TimeZoneSelect value={timeZone} onChange={setTimeZone} teamTimeZone={teamTimeZone} />

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
                        <UniformOptions team={team} />
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Notify toggle — a new event tells the team unless switched off */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Notify the team</Label>
                <p className="text-sm text-muted-foreground">
                  Email and push the families about this event
                </p>
              </div>
              <Switch checked={notifyTeam} onCheckedChange={setNotifyTeam} aria-label="Notify the team" />
            </div>

            {/* Recurring toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Recurring event</Label>
                <p className="text-sm text-muted-foreground">
                  Repeat this event on a schedule
                </p>
              </div>
              <Switch checked={isRecurring} onCheckedChange={setIsRecurring} aria-label="Recurring event" />
            </div>

            {isRecurring && (
              <div className="space-y-4 rounded-md border p-4">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select
                    value={frequencyMode}
                    onValueChange={(v) =>
                      setFrequencyMode(v as "weekly" | "biweekly" | "custom")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {frequencyMode === "custom" && (
                  <>
                    <div className="space-y-2">
                      <Label>Repeat every</Label>
                      <Select
                        value={customInterval}
                        onValueChange={(v) =>
                          setCustomInterval(v as "weekly" | "biweekly")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">1 week</SelectItem>
                          <SelectItem value="biweekly">2 weeks</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>On days</Label>
                      <div className="flex gap-1.5">
                        {DAY_LABELS.map((label, idx) => {
                          const isStartDay = idx === startDayRRule;
                          const isSelected =
                            customDays.includes(idx) || isStartDay;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                if (isStartDay) return;
                                setCustomDays((prev) =>
                                  prev.includes(idx)
                                    ? prev.filter((d) => d !== idx)
                                    : [...prev, idx]
                                );
                              }}
                              className={`h-8 w-8 rounded-full text-sm font-medium transition-colors ${
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "border hover:bg-muted text-muted-foreground"
                              } ${isStartDay ? "cursor-default" : "cursor-pointer"}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

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
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
