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
import { EditRecurringPrompt, type RecurringEditScope } from "./edit-recurring-prompt";
import { SeriesEditForm } from "./series-edit-form";
import { RsvpButtons } from "@/components/availability/rsvp-buttons";
import { ResponseList } from "@/components/availability/response-list";
import { getRecurrenceDescription } from "@/lib/utils/rrule";
import { pinnedStartRule } from "@/lib/events/series-edit";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];
type EventWithLocation = Event & {
  locations: { name: string; address: string | null } | null;
};
type EditState = null | "prompt" | RecurringEditScope;

function toLocalDatetime(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

// ── Inline edit form ──────────────────────────────────────────────────────────

function EventEditForm({
  editingEvent,
  teamId,
  homeUniform,
  awayUniform,
  onSave,
  onCancel,
}: {
  editingEvent: Event;
  teamId: string;
  homeUniform?: string | null;
  awayUniform?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();

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

    // A series head carries the pattern. Pin its start before this occurrence
    // moves, so the other occurrences keep their dates (BUG-009).
    const { error } = await supabase
      .from("events")
      .update(
        editingEvent.recurrence_rule
          ? { ...eventData, recurrence_rule: pinnedStartRule(editingEvent) }
          : eventData
      )
      .eq("id", editingEvent.id);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    toast.success("Event updated");

    setSaving(false);
    onSave();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit event</CardTitle>
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
  // Every occurrence of this event's series, loaded for a bulk edit or delete.
  const [series, setSeries] = useState<Event[] | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<{ occurrences: number; responses: number } | null>(null);
  const [confirmSeriesDelete, setConfirmSeriesDelete] = useState(false);

  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);

  async function loadSeries(): Promise<Event[] | null> {
    const headId = event.parent_event_id ?? event.id;
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .or(`id.eq.${headId},parent_event_id.eq.${headId}`)
      .order("start_time");
    if (error || !data || data.length === 0) {
      toast.error("Could not load the series.");
      return null;
    }
    return data;
  }

  // Deletes only this event. Deleting the first occurrence of a series hands
  // the series on to the next one (BUG-009).
  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase.rpc("delete_event_occurrence", {
      p_event_id: event.id,
      p_promoted_head_rule: event.recurrence_rule ? pinnedStartRule(event) : undefined,
    });

    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }

    toast.success("Event deleted");
    router.push("/dashboard/schedule");
    router.refresh();
  }

  async function handleAskDeleteSeries() {
    setDeleting(true);
    const rows = await loadSeries();
    if (!rows) {
      setDeleting(false);
      return;
    }
    const { count } = await supabase
      .from("availability")
      .select("*", { count: "exact", head: true })
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    setDeleteSummary({ occurrences: rows.length, responses: count ?? 0 });
    setConfirmSeriesDelete(true);
    setDeleting(false);
  }

  async function handleDeleteSeries() {
    setDeleting(true);
    const { data, error } = await supabase.rpc("delete_event_series", {
      p_event_id: event.id,
    });

    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }

    toast.success(`Series deleted (${data} events)`);
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

  async function handleChooseScope(scope: RecurringEditScope) {
    if (scope === "single") {
      setEditState("single");
      return;
    }
    const rows = await loadSeries();
    if (!rows) {
      setEditState(null);
      return;
    }
    setSeries(rows);
    setEditState(scope);
  }

  function handleEditSave() {
    const wasBulk = editState === "following" || editState === "series";
    setEditState(null);
    setSeries(null);
    if (wasBulk) {
      router.push("/dashboard/schedule");
    } else {
      router.refresh();
    }
  }

  function handleEditCancel() {
    setEditState(null);
    setSeries(null);
  }

  const eventTypeColor: Record<string, string> = {
    practice: "bg-blue-100 text-blue-800",
    game: "bg-green-100 text-green-800",
    other: "bg-purple-100 text-purple-800",
  };

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const bulkScope = editState === "following" || editState === "series" ? editState : null;
  if (editState === "single" || (bulkScope && series)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/dashboard/schedule"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to schedule
        </Link>
        {bulkScope && series ? (
          <SeriesEditForm
            series={series}
            openedId={event.id}
            scope={bulkScope}
            teamId={event.team_id!}
            homeUniform={homeUniform}
            awayUniform={awayUniform}
            onSave={handleEditSave}
            onCancel={handleEditCancel}
          />
        ) : (
          <EventEditForm
            editingEvent={event}
            teamId={event.team_id!}
            homeUniform={homeUniform}
            awayUniform={awayUniform}
            onSave={handleEditSave}
            onCancel={handleEditCancel}
          />
        )}
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
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recurring edit prompt */}
      <EditRecurringPrompt
        open={editState === "prompt"}
        onClose={() => setEditState(null)}
        onChoose={handleChooseScope}
      />

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event</DialogTitle>
            <DialogDescription>
              {isRecurring ? (
                <>
                  Delete only this event, or every event in the series? Deleted events and their
                  availability responses can&apos;t be recovered.
                </>
              ) : (
                <>
                  Are you sure you want to delete &ldquo;{event.title}&rdquo;? This
                  action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            {isRecurring && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={handleAskDeleteSeries}
                disabled={deleting}
              >
                Entire series…
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : isRecurring ? "This event" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Whole-series delete: a separate, explicit confirmation */}
      <AlertDialog
        open={confirmSeriesDelete}
        onOpenChange={(open) => {
          setConfirmSeriesDelete(open);
          if (!open) setDeleteSummary(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the entire series?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSummary && (
                <>
                  This permanently deletes all {deleteSummary.occurrences} events in the
                  &ldquo;{event.title}&rdquo; series, past events included, and{" "}
                  {deleteSummary.responses} availability{" "}
                  {deleteSummary.responses === 1 ? "response" : "responses"}. To stop the series
                  without losing its history, edit the entire series and set an earlier
                  &ldquo;Repeat until&rdquo; date instead.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Back</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDeleteSeries} disabled={deleting}>
              {deleting ? "Deleting..." : `Delete ${deleteSummary?.occurrences ?? ""} events`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
