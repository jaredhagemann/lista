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
import { Switch } from "@/components/ui/switch";
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
import { eventTimeZone, instantFromWallClock, wallClockIn } from "@/lib/events/event-timezone";
import { browserTimeZone } from "@/lib/events/team-timezone";
import { formatEventDate, formatEventTime, formatEventTimeRange } from "@/lib/notifications/event-time";
import { TimeZoneSelect } from "./time-zone-select";
import { GameTitleHint } from "@/components/events/game-title-hint";
import { UniformOptions } from "@/components/events/uniform-options";
import { UniformLabel } from "@/components/events/uniform-label";
import { gameTitle, homeAwayLabel, uniformOf, type TeamDisplay } from "@/lib/events/game-display";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];
type EventWithLocation = Event & {
  locations: { name: string; address: string | null } | null;
};
type EditState = null | "prompt" | RecurringEditScope;

// Start and end are wall-clock times in the event's zone, never the browser's (BUG-010).
const wallMs = (wall: string) => Date.parse(`${wall}:00.000Z`);
const shiftWall = (wall: string, ms: number) => new Date(wallMs(wall) + ms).toISOString().slice(0, 16);

// ── Inline edit form ──────────────────────────────────────────────────────────

export function EventEditForm({
  editingEvent,
  teamId,
  timeZone: eventZone,
  teamTimeZone,
  team,
  onSave,
  onCancel,
}: {
  editingEvent: Event;
  teamId: string;
  /** The zone the event is in now: its own, or the team's for an event from before event zones. */
  timeZone: string;
  teamTimeZone?: string | null;
  /** Names games and their uniforms (spec: game-display-and-uniform-colors). */
  team: TeamDisplay;
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
  // Changing the zone keeps the times as typed: the same local time, somewhere else.
  const [timeZone, setTimeZone] = useState(eventZone);
  const originalStart = wallClockIn(editingEvent.start_time, eventZone);
  const originalEnd = wallClockIn(editingEvent.end_time, eventZone);
  const [startTime, setStartTime] = useState(originalStart);
  const [endTime, setEndTime] = useState(originalEnd);

  /**
   * The stored instant while the time and zone are as loaded; otherwise the typed time
   * read in the chosen zone. The inputs hold minutes only, so in an hour that happens
   * twice (fall back) re-reading an untouched time could land on the other pass of it
   * and move the event (PR #81 review).
   */
  function instantFor(wall: string, original: string, stored: string): string {
    if (wall === original && timeZone === eventZone) return new Date(stored).toISOString();
    return instantFromWallClock(wall, timeZone).toISOString();
  }
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
  // D3: time, arrival time and location changes notify by themselves (the
  // database enqueues them). A title or notes edit only notifies if asked.
  const [notifyTeam, setNotifyTeam] = useState(false);

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
      setEndTime(shiftWall(newStart, wallMs(endTime) - wallMs(startTime)));
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
      start_time: instantFor(startTime, originalStart, editingEvent.start_time),
      end_time: instantFor(endTime, originalEnd, editingEvent.end_time),
      timezone: timeZone,
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
          ? { ...eventData, recurrence_rule: pinnedStartRule(editingEvent, eventZone) }
          : eventData
      )
      .eq("id", editingEvent.id);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    const schedulingChanged =
      Date.parse(eventData.start_time) !== Date.parse(editingEvent.start_time) ||
      Date.parse(eventData.end_time) !== Date.parse(editingEvent.end_time) ||
      // Recording a zone on an event that had none changes nobody's view of it.
      (editingEvent.timezone != null && eventData.timezone !== editingEvent.timezone) ||
      eventData.arrival_time !== editingEvent.arrival_time ||
      eventData.location_id !== editingEvent.location_id;

    if (!schedulingChanged && notifyTeam) {
      const { error: queueError } = await supabase.rpc("enqueue_event_notification", {
        p_event_id: editingEvent.id,
        p_action: "updated",
      });
      if (queueError) {
        toast.error(`Event saved, but the notification could not be queued: ${queueError.message}`);
      }
    }

    const summary = schedulingChanged || notifyTeam ? await drainNotifications() : null;
    toast.success(withNotice("Event updated", summary));

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
            <GameTitleHint
              eventType={eventType}
              title={title}
              opponent={opponent}
              homeAway={homeAway}
              teamName={team.name}
            />
          </div>

          {/* Event type */}
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

          <TimeZoneSelect value={timeZone} onChange={setTimeZone} teamTimeZone={teamTimeZone} />

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
                      <UniformOptions team={team} />
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

          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label htmlFor="notifyTeam">Notify the team</Label>
              <p className="text-sm text-muted-foreground">
                Date, time and location changes are always sent. Switch this on to tell
                families about other edits too.
              </p>
            </div>
            <Switch id="notifyTeam" checked={notifyTeam} onCheckedChange={setNotifyTeam} />
          </div>

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

/**
 * What happened to the last notice about this event (BUG-006, D3): saved and
 * sent are different things, and a coach can see which. "Sent" means the
 * delivery service accepted it, not that anyone read it.
 */
function NotificationStatus({ eventId }: { eventId: string }) {
  const supabase = createClient();
  const [job, setJob] = useState<{
    status: string;
    created_at: string;
    sent: number;
    failed: number;
    skipped: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("notification_jobs")
        .select("id, status, created_at, notification_deliveries(status)")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled || !data) return;
      const deliveries = (data.notification_deliveries ?? []) as { status: string }[];
      setJob({
        status: data.status,
        created_at: data.created_at,
        sent: deliveries.filter((d) => d.status === "sent").length,
        failed: deliveries.filter((d) => d.status === "failed").length,
        skipped: deliveries.filter((d) => d.status === "skipped").length,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId, supabase]);

  if (!job) return null;

  const when = new Date(job.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const waiting = job.status === "pending" || job.status === "sending";
  const label = waiting
    ? "Queued — sending shortly"
    : [
        `Sent ${job.sent}`,
        job.skipped > 0 ? `${job.skipped} skipped` : null,
        job.failed > 0 ? `${job.failed} failed` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="rounded-md border p-3 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Notifications:</span> {label}
      {!waiting && ` · ${when}`}
      {job.status === "failed" && " — we'll retry"}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EventDetail({
  event,
  isAdmin,
  creatorName,
  initialEdit = false,
  team,
  teamTimeZone,
  currentUserId,
  availabilityRows,
  members,
}: {
  event: EventWithLocation;
  isAdmin: boolean;
  creatorName: string;
  initialEdit?: boolean;
  /** The team's zone, for an event from before event zones. */
  teamTimeZone?: string | null;
  /** Names games and their uniforms (spec: game-display-and-uniform-colors). */
  team: TeamDisplay;
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
  // A game is named by its team and opponent everywhere, dialogs included; a
  // whole series without a score, which belongs to one game (spec:
  // game-display-and-uniform-colors).
  const title = gameTitle(event, team.name);
  const seriesTitle = gameTitle(event, team.name, { includeScore: false });
  // Shown and edited in the event's own zone, wherever the viewer is (BUG-010).
  const [viewerZone] = useState(() => browserTimeZone() ?? "UTC");
  const zone = eventTimeZone(event, teamTimeZone, viewerZone);

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
      p_promoted_head_rule: event.recurrence_rule ? pinnedStartRule(event, zone) : undefined,
    });

    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }

    toast.success(withNotice("Event deleted", await drainNotifications()));
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

    toast.success(withNotice(`Series deleted (${data} events)`, await drainNotifications()));
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

    toast.success(withNotice("Event cancelled", await drainNotifications()));
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

    toast.success(withNotice("Event restored", await drainNotifications()));
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
            fallbackTimeZone={eventTimeZone({}, teamTimeZone, viewerZone)}
            teamTimeZone={teamTimeZone}
            team={team}
            onSave={handleEditSave}
            onCancel={handleEditCancel}
          />
        ) : (
          <EventEditForm
            editingEvent={event}
            teamId={event.team_id!}
            timeZone={zone}
            teamTimeZone={teamTimeZone}
            team={team}
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
                <CardTitle className="text-2xl">
                  <h1>{title}</h1>
                </CardTitle>
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
                  aria-label="Edit event"
                  onClick={handleEditClick}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Delete event"
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
              {formatEventDate(event.start_time, zone)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {formatEventTimeRange(event.start_time, event.end_time, zone)}
            </span>
          </div>
          {event.arrival_time != null && (
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                Arrive by{" "}
                {formatEventTime(new Date(startDate.getTime() - event.arrival_time * 60 * 1000), zone)}{" "}
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

          {isAdmin && <NotificationStatus eventId={event.id} />}

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
                      <Badge variant="outline">{homeAwayLabel(event.home_away)}</Badge>
                    </div>
                  )}
                  {uniformOf(event.uniform, team) && (
                    <div>
                      <span className="text-muted-foreground">Uniform:</span>{" "}
                      <UniformLabel uniform={uniformOf(event.uniform, team)} />
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
              &ldquo;{title}&rdquo; will be marked as cancelled. Team members will still be able to see it on the schedule.
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
              &ldquo;{title}&rdquo; will be restored and no longer marked as cancelled.
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
                  Are you sure you want to delete &ldquo;{title}&rdquo;? This
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
                  &ldquo;{seriesTitle}&rdquo; series, past events included, and{" "}
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
