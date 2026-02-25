"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Pencil,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { EditRecurringPrompt } from "./edit-recurring-prompt";
import { RsvpButtons } from "@/components/availability/rsvp-buttons";
import { ResponseList } from "@/components/availability/response-list";
import {
  buildRRule,
  expandRecurrenceFromLocalString,
  parseRRule,
  getRecurrenceDescription,
} from "@/lib/utils/rrule";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];
type EventWithLocation = Event & {
  locations: { name: string; address: string | null } | null;
};
type EditState = null | "prompt" | "single" | "series";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function toLocalDatetime(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function jsToRRuleDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ── Inline edit form ──────────────────────────────────────────────────────────

function EventEditForm({
  editingEvent,
  editMode,
  teamId,
  homeUniform,
  awayUniform,
  onSave,
  onCancel,
}: {
  editingEvent: Event;
  editMode: "single" | "series";
  teamId: string;
  homeUniform?: string | null;
  awayUniform?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();

  const parsedRRule =
    editMode === "series" && editingEvent.recurrence_rule
      ? parseRRule(editingEvent.recurrence_rule)
      : null;

  const [title, setTitle] = useState(editingEvent.title);
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    editingEvent.event_type as "practice" | "game" | "other"
  );
  const [locationId, setLocationId] = useState(editingEvent.location_id ?? "");
  const [notes, setNotes] = useState(editingEvent.notes ?? "");
  const [startTime, setStartTime] = useState(
    toLocalDatetime(new Date(editingEvent.start_time))
  );
  const [endTime, setEndTime] = useState(
    toLocalDatetime(new Date(editingEvent.end_time))
  );
  const [opponent, setOpponent] = useState(editingEvent.opponent ?? "");
  const [homeAway, setHomeAway] = useState(editingEvent.home_away ?? "");
  const [uniform, setUniform] = useState(editingEvent.uniform ?? "");
  const [gameResult, setGameResult] = useState(editingEvent.game_result ?? "");
  const [scoreFor, setScoreFor] = useState(
    editingEvent.score_for?.toString() ?? ""
  );
  const [scoreAgainst, setScoreAgainst] = useState(
    editingEvent.score_against?.toString() ?? ""
  );
  const [arrivalTime, setArrivalTime] = useState(
    editingEvent.arrival_time?.toString() ?? ""
  );

  const [locations, setLocations] = useState<Location[]>([]);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");

  // Recurrence (series edit only)
  const [frequencyMode, setFrequencyMode] = useState<
    "weekly" | "biweekly" | "custom"
  >(() => {
    if (!parsedRRule) return "weekly";
    if (parsedRRule.daysOfWeek.length > 1) return "custom";
    return parsedRRule.interval === 2 ? "biweekly" : "weekly";
  });
  const [customInterval, setCustomInterval] = useState<"weekly" | "biweekly">(
    () => (parsedRRule?.interval === 2 ? "biweekly" : "weekly")
  );
  const [customDays, setCustomDays] = useState<number[]>(
    () => parsedRRule?.daysOfWeek ?? []
  );
  const [recurUntil, setRecurUntil] = useState(() => {
    if (parsedRRule?.until) return parsedRRule.until.toISOString().slice(0, 10);
    return "";
  });

  const [saving, setSaving] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be signed in.");
      setSaving(false);
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
        setSaving(false);
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
      game_result: eventType === "game" ? gameResult || null : null,
      score_for:
        eventType === "game" && scoreFor !== ""
          ? parseInt(scoreFor, 10)
          : null,
      score_against:
        eventType === "game" && scoreAgainst !== ""
          ? parseInt(scoreAgainst, 10)
          : null,
      arrival_time: arrivalTime !== "" ? parseInt(arrivalTime, 10) : null,
    };

    if (editMode === "series") {
      // Build new rrule
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const durationMs = endDate.getTime() - startDate.getTime();
      const startDayRRule = jsToRRuleDay(startDate.getDay());

      let newRruleString: string | null = editingEvent.recurrence_rule;
      if (recurUntil) {
        const daysOfWeek =
          frequencyMode === "custom"
            ? [...new Set([startDayRRule, ...customDays])]
            : [startDayRRule];
        newRruleString = buildRRule({
          frequency:
            frequencyMode === "custom"
              ? customInterval
              : (frequencyMode as "weekly" | "biweekly"),
          daysOfWeek,
          until: new Date(recurUntil),
        });
      }

      // Compute diff for notification
      type FieldChange = { field: string; before: string; after: string };
      const formatValue = (field: string, val: unknown): string => {
        if (val == null || val === "") return "—";
        if (field === "start_time" || field === "end_time") {
          const d = new Date(val as string);
          return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        }
        if (field === "arrival_time") return `${val} min early`;
        if (field === "location_id")
          return locations.find((l) => l.id === val)?.name ?? String(val);
        if (field === "recurrence_rule")
          return getRecurrenceDescription(val as string);
        return String(val);
      };
      const before = {
        title: editingEvent.title,
        start_time: editingEvent.start_time,
        end_time: editingEvent.end_time,
        arrival_time: editingEvent.arrival_time,
        location_id: editingEvent.location_id,
        notes: editingEvent.notes,
        recurrence_rule: editingEvent.recurrence_rule,
      };
      const after = {
        title: eventData.title,
        start_time: eventData.start_time,
        end_time: eventData.end_time,
        arrival_time: eventData.arrival_time,
        location_id: eventData.location_id,
        notes: eventData.notes,
        recurrence_rule: newRruleString,
      };
      const fieldLabels: Record<string, string> = {
        title: "Title",
        start_time: "Start time",
        end_time: "End time",
        arrival_time: "Arrival time",
        location_id: "Location",
        notes: "Notes",
        recurrence_rule: "Recurrence",
      };
      const changes: FieldChange[] = [];
      for (const key of Object.keys(before) as Array<keyof typeof before>) {
        const b = before[key];
        const a = after[key as keyof typeof after];
        if ((b == null ? "" : String(b)) !== (a == null ? "" : String(a))) {
          changes.push({
            field: fieldLabels[key],
            before: formatValue(key, b),
            after: formatValue(key, a),
          });
        }
      }

      // Update parent event
      const { error: updateError } = await supabase
        .from("events")
        .update({ ...eventData, recurrence_rule: newRruleString })
        .eq("id", editingEvent.id);
      if (updateError) {
        toast.error(updateError.message);
        setSaving(false);
        return;
      }

      // Delete all children
      const { error: deleteError } = await supabase
        .from("events")
        .delete()
        .eq("parent_event_id", editingEvent.id);
      if (deleteError) {
        toast.error(deleteError.message);
        setSaving(false);
        return;
      }

      // Re-expand and re-insert children
      if (newRruleString) {
        const occurrences = expandRecurrenceFromLocalString(
          startTime,
          newRruleString
        );
        const childEvents = occurrences.slice(1).map((date) => ({
          ...eventData,
          game_result: null,
          score_for: null,
          score_against: null,
          start_time: date.toISOString(),
          end_time: new Date(date.getTime() + durationMs).toISOString(),
          parent_event_id: editingEvent.id,
        }));
        if (childEvents.length > 0) {
          const { error: childError } = await supabase
            .from("events")
            .insert(childEvents);
          if (childError) {
            toast.error(childError.message);
            setSaving(false);
            return;
          }
        }
      }

      fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: editingEvent.id,
          action: "series_updated",
          changes,
        }),
      }).catch(() => {});

      toast.success("Series updated");
    } else {
      const { error } = await supabase
        .from("events")
        .update(eventData)
        .eq("id", editingEvent.id);
      if (error) {
        toast.error(error.message);
        setSaving(false);
        return;
      }
      toast.success("Event updated");
    }

    setSaving(false);
    onSave();
  }

  const startDayRRule = jsToRRuleDay(new Date(startTime).getDay());

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editMode === "series" ? "Edit series" : "Edit event"}
        </CardTitle>
        {editMode === "series" && (
          <p className="text-sm text-muted-foreground">
            Changes will apply to all events in this series.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Event type */}
          <div className="space-y-2">
            <Label>Type</Label>
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

          {/* Location */}
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

          {/* Arrival time */}
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

          {/* Start / End */}
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

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Game details */}
          {eventType === "game" && (
            <div className="space-y-4 rounded-md border p-4">
              <h4 className="text-sm font-medium">Game details</h4>
              <div className="space-y-2">
                <Label htmlFor="opponent">Opponent</Label>
                <Input
                  id="opponent"
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
              {editMode === "single" && (
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

          {/* Recurrence controls — series edit only */}
          {editMode === "series" && (
            <div className="space-y-4 rounded-md border p-4">
              <h4 className="text-sm font-medium">Recurrence</h4>
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
                  required
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EventDetail({
  event,
  isAdmin,
  creatorName,
  initialEdit = false,
  homeUniform,
  awayUniform,
  currentUserId,
  availabilityRows,
  members,
}: {
  event: EventWithLocation;
  isAdmin: boolean;
  creatorName: string;
  initialEdit?: boolean;
  homeUniform?: string | null;
  awayUniform?: string | null;
  currentUserId: string;
  availabilityRows: { profileId: string; status: "available" | "maybe" | "unavailable" }[];
  members: { profileId: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showRestore, setShowRestore] = useState(false);

  const isRecurring =
    event.parent_event_id != null || event.recurrence_rule != null;

  const [editState, setEditState] = useState<EditState>(() => {
    if (!initialEdit || !isAdmin || event.is_cancelled) return null;
    return isRecurring ? "prompt" : "single";
  });
  const [parentEvent, setParentEvent] = useState<Event | null>(null);

  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);

  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", event.id);

    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }

    toast.success("Event deleted");
    router.push("/dashboard/schedule");
    router.refresh();
  }

  async function handleCancel() {
    const { error } = await supabase
      .from("events")
      .update({ is_cancelled: true })
      .eq("id", event.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Event cancelled");
    router.refresh();
  }

  async function handleRestore() {
    const { error } = await supabase
      .from("events")
      .update({ is_cancelled: false })
      .eq("id", event.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Event restored");
    router.refresh();
  }

  function handleEditClick() {
    setEditState(isRecurring ? "prompt" : "single");
  }

  async function handleEditSeries() {
    let parent: Event | null = null;
    if (event.parent_event_id) {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("id", event.parent_event_id)
        .single();
      parent = data as Event | null;
    } else {
      parent = event;
    }

    if (!parent) {
      toast.error("Could not find the series.");
      setEditState(null);
      return;
    }

    setParentEvent(parent);
    setEditState("series");
  }

  function handleEditSave() {
    const wasSeries = editState === "series";
    setEditState(null);
    setParentEvent(null);
    if (wasSeries) {
      router.push("/dashboard/schedule");
    } else {
      router.refresh();
    }
  }

  function handleEditCancel() {
    setEditState(null);
    setParentEvent(null);
  }

  const eventTypeColor: Record<string, string> = {
    practice: "bg-blue-100 text-blue-800",
    game: "bg-red-100 text-red-800",
    other: "bg-purple-100 text-purple-800",
  };

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editState === "single" || (editState === "series" && parentEvent)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/dashboard/schedule"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to schedule
        </Link>
        <EventEditForm
          editingEvent={editState === "series" ? parentEvent! : event}
          editMode={editState === "series" ? "series" : "single"}
          teamId={event.team_id!}
          homeUniform={homeUniform}
          awayUniform={awayUniform}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      </div>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/dashboard/schedule"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to schedule
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl">{event.title}</CardTitle>
                {event.is_cancelled && (
                  <Badge variant="destructive">Cancelled</Badge>
                )}
              </div>
              <Badge
                className={eventTypeColor[event.event_type] ?? ""}
                variant="secondary"
              >
                {event.event_type}
              </Badge>
            </div>
            {isAdmin && !event.is_cancelled && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleEditClick}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>
              {startDate.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {startDate.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              —{" "}
              {endDate.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          {event.arrival_time != null && (
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                Arrive by{" "}
                {new Date(
                  startDate.getTime() - event.arrival_time * 60 * 1000
                ).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                <span className="text-muted-foreground">
                  ({event.arrival_time} min early)
                </span>
              </span>
            </div>
          )}
          {event.locations && (
            <div className="flex items-start gap-3 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <span>{event.locations.name}</span>
                {event.locations.address && (
                  <p className="text-muted-foreground">
                    {event.locations.address}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>Created by {creatorName}</span>
          </div>

          {event.recurrence_rule && (
            <div className="rounded-md bg-accent p-3 text-sm">
              Recurring: {getRecurrenceDescription(event.recurrence_rule)}
            </div>
          )}

          {event.event_type === "game" &&
            (event.opponent ||
              event.home_away ||
              event.uniform ||
              event.game_result) && (
              <div className="border-t pt-4">
                <h3 className="mb-2 font-medium">Game details</h3>
                <div className="space-y-2 text-sm">
                  {event.opponent && (
                    <div>
                      <span className="text-muted-foreground">Opponent:</span>{" "}
                      {event.opponent}
                    </div>
                  )}
                  {event.home_away && (
                    <div>
                      <Badge variant="outline" className="capitalize">
                        {event.home_away}
                      </Badge>
                    </div>
                  )}
                  {event.uniform && (
                    <div>
                      <span className="text-muted-foreground">Uniform:</span>{" "}
                      <span className="capitalize">{event.uniform}</span>
                    </div>
                  )}
                  {event.game_result && (
                    <div>
                      <span className="text-muted-foreground">Result:</span>{" "}
                      <Badge
                        variant={
                          event.game_result === "win"
                            ? "default"
                            : event.game_result === "loss"
                              ? "destructive"
                              : "secondary"
                        }
                        className="capitalize"
                      >
                        {event.game_result}
                      </Badge>
                      {event.score_for != null &&
                        event.score_against != null && (
                          <span className="ml-2">
                            {event.score_for} – {event.score_against}
                          </span>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}

          {event.notes && (
            <div className="border-t pt-4">
              <h3 className="mb-2 font-medium">Notes</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {event.notes}
              </p>
            </div>
          )}

          {isAdmin && (
            <div className="border-t pt-4">
              {!event.is_cancelled ? (
                <Button variant="outline" onClick={() => setShowCancel(true)}>
                  Cancel this event
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setShowRestore(true)}>
                  Restore this event
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Availability */}
      {!event.is_cancelled && (() => {
        const isPast = new Date(event.start_time) < new Date();
        const myRow = availabilityRows.find((r) => r.profileId === currentUserId);
        return (
          <Card>
            <CardContent className="pt-6 space-y-6">
              {!isPast && (
                <RsvpButtons
                  eventId={event.id}
                  profileId={currentUserId}
                  initialStatus={myRow?.status ?? null}
                />
              )}
              {isPast && (
                <p className="text-sm text-muted-foreground">
                  RSVP is closed — this event has already started.
                </p>
              )}
              <div className="border-t pt-4">
                <ResponseList
                  eventId={event.id}
                  members={members}
                  initialRows={availabilityRows}
                  isAdmin={isAdmin}
                  currentUserId={currentUserId}
                />
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Cancel confirmation */}
      <AlertDialog open={showCancel} onOpenChange={setShowCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{event.title}&rdquo; will be marked as cancelled. Team members will still be able to see it on the schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>
              Cancel event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore confirmation */}
      <AlertDialog open={showRestore} onOpenChange={setShowRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{event.title}&rdquo; will be restored and no longer marked as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore}>
              Restore event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recurring edit prompt */}
      <EditRecurringPrompt
        open={editState === "prompt"}
        onClose={() => setEditState(null)}
        onEditSingle={() => setEditState("single")}
        onEditSeries={handleEditSeries}
      />

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{event.title}&rdquo;? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
