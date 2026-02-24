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

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function toLocalDatetime(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function jsToRRuleDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function EventFormDialog({
  open,
  onClose,
  teamId,
  defaultStart,
  homeUniform,
  awayUniform,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  defaultStart?: Date;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    "practice"
  );
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  const defaultStartTime = (() => {
    const base = defaultStart ? new Date(defaultStart) : new Date();
    base.setHours(12, 0, 0, 0);
    return toLocalDatetime(base);
  })();

  const defaultEndTime = (() => {
    const base = defaultStart ? new Date(defaultStart) : new Date();
    base.setHours(13, 0, 0, 0);
    return toLocalDatetime(base);
  })();

  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);

  function handleStartTimeChange(newStart: string) {
    if (newStart && startTime && endTime) {
      const durationMs =
        new Date(endTime).getTime() - new Date(startTime).getTime();
      setEndTime(
        toLocalDatetime(new Date(new Date(newStart).getTime() + durationMs))
      );
    }
    if (frequencyMode === "custom" && newStart) {
      const rruleDay = jsToRRuleDay(new Date(newStart).getDay());
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
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
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
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const durationMs = endDate.getTime() - startDate.getTime();
      const startDayRRule = jsToRRuleDay(startDate.getDay());

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
        until: new Date(recurUntil),
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

      const occurrences = expandRecurrenceFromLocalString(startTime, rruleString);
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

  const startDayRRule = jsToRRuleDay(new Date(startTime).getDay());

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
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventType">Type</Label>
              <Select
                value={eventType}
                onValueChange={(v) =>
                  setEventType(v as "practice" | "game" | "other")
                }
              >
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
              </div>
            )}

            {/* Recurring toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Recurring event</Label>
                <p className="text-sm text-muted-foreground">
                  Repeat this event on a schedule
                </p>
              </div>
              <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
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
