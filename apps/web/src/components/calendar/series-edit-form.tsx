"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getRecurrenceDescription, parseRRule } from "@/lib/utils/rrule";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import {
  planSeriesEdit,
  resolveSeriesEdit,
  SeriesEditError,
  toWallClock,
  type BulkFields,
  type SeriesEditPlan,
  type SeriesEditScope,
  type SeriesPattern,
} from "@/lib/events/series-edit";
import type { Database, Json } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function jsToRRuleDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function clock(iso: string) {
  return toWallClock(iso).slice(11, 16);
}

function formatOccurrence(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Edits "This and following" or the "Entire series" of a recurring event
 * (BUG-009, decision D4). Past events are never changed. Occurrences keep their
 * ids, availability and results; dates dropped from the pattern are cancelled,
 * not deleted; new dates are added. The whole change applies in one transaction.
 */
export function SeriesEditForm({
  series,
  openedId,
  scope,
  teamId,
  homeUniform,
  awayUniform,
  onSave,
  onCancel,
}: {
  /** Every occurrence of the opened event's series, head included. */
  series: Event[];
  openedId: string;
  scope: SeriesEditScope;
  teamId: string;
  homeUniform?: string | null;
  awayUniform?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();

  // The occurrence the form is prefilled from: where this edit begins.
  const { head, anchor } = useMemo(
    () => resolveSeriesEdit(series, openedId, scope, new Date()),
    [series, openedId, scope]
  );
  const original = useMemo(() => parseRRule(head.recurrence_rule!), [head]);
  const originalUntil = original.until ? original.until.toISOString().slice(0, 10) : "";
  const anchorDay = jsToRRuleDay(new Date(anchor.start_time).getDay());

  const [title, setTitle] = useState(anchor.title);
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    anchor.event_type as "practice" | "game" | "other"
  );
  const [locationId, setLocationId] = useState(anchor.location_id ?? "");
  const [notes, setNotes] = useState(anchor.notes ?? "");
  const [arrivalTime, setArrivalTime] = useState(anchor.arrival_time?.toString() ?? "");
  const [opponent, setOpponent] = useState(anchor.opponent ?? "");
  const [homeAway, setHomeAway] = useState(anchor.home_away ?? "");
  const [uniform, setUniform] = useState(anchor.uniform ?? "");
  const [startClock, setStartClock] = useState(clock(anchor.start_time));
  const [endClock, setEndClock] = useState(clock(anchor.end_time));

  const [locations, setLocations] = useState<Location[]>([]);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");

  const [frequencyMode, setFrequencyMode] = useState<"weekly" | "biweekly" | "custom">(() => {
    if (original.daysOfWeek.length > 1) return "custom";
    return original.interval === 2 ? "biweekly" : "weekly";
  });
  const [customInterval, setCustomInterval] = useState<"weekly" | "biweekly">(
    original.interval === 2 ? "biweekly" : "weekly"
  );
  const [customDays, setCustomDays] = useState<number[]>(original.daysOfWeek);
  const [recurUntil, setRecurUntil] = useState(originalUntil);

  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ plan: SeriesEditPlan; changes: FieldChange[] } | null>(null);

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

  type FieldChange = { field: string; before: string; after: string };

  function currentPattern(): SeriesPattern {
    const frequency = frequencyMode === "custom" ? customInterval : frequencyMode;
    const daysOfWeek =
      frequencyMode === "custom" ? [...new Set([anchorDay, ...customDays])].sort() : [anchorDay];
    return { frequency, daysOfWeek, untilDate: recurUntil };
  }

  function patternChanged(pattern: SeriesPattern) {
    const originalDays = [...original.daysOfWeek].sort().join(",");
    return (
      (pattern.frequency === "biweekly" ? 2 : 1) !== original.interval ||
      pattern.daysOfWeek.join(",") !== originalDays ||
      pattern.untilDate !== originalUntil
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

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

    const desired: Required<BulkFields> = {
      title,
      event_type: eventType,
      location_id: resolvedLocationId,
      notes: notes || null,
      arrival_time: arrivalTime !== "" ? parseInt(arrivalTime, 10) : null,
      opponent: eventType === "game" ? opponent || null : null,
      home_away: eventType === "game" ? homeAway || null : null,
      uniform: eventType === "game" ? uniform || null : null,
    };
    const fields = Object.fromEntries(
      Object.entries(desired).filter(([key, value]) => anchor[key as keyof BulkFields] !== value)
    ) as BulkFields;
    const timeChanged = startClock !== clock(anchor.start_time) || endClock !== clock(anchor.end_time);
    const pattern = currentPattern();
    const changedPattern = patternChanged(pattern);

    if (Object.keys(fields).length === 0 && !timeChanged && !changedPattern) {
      toast.info("No changes to save.");
      setSaving(false);
      return;
    }

    let plan: SeriesEditPlan;
    try {
      plan = planSeriesEdit({
        occurrences: series,
        openedId,
        scope,
        now: new Date(),
        fields,
        time: timeChanged ? { start: startClock, end: endClock } : undefined,
        pattern: changedPattern ? pattern : undefined,
      });
    } catch (err) {
      toast.error(err instanceof SeriesEditError ? err.message : "Could not plan this change.");
      setSaving(false);
      return;
    }

    const changes = describeChanges(fields, timeChanged, changedPattern ? plan.newHeadRule : null);

    // Show what will happen before cancelling or adding occurrences (D4).
    if (plan.cancels.length > 0 || plan.inserts.length > 0) {
      setPending({ plan, changes });
      setSaving(false);
      return;
    }

    await apply(plan);
  }

  function describeChanges(fields: BulkFields, timeChanged: boolean, newRule: string | null): FieldChange[] {
    const labels: Record<string, string> = {
      title: "Title",
      event_type: "Type",
      location_id: "Location",
      notes: "Notes",
      arrival_time: "Arrival time",
      opponent: "Opponent",
      home_away: "Home / away",
      uniform: "Uniform",
    };
    const show = (key: string, value: unknown) => {
      if (value == null || value === "") return "—";
      if (key === "location_id") return locations.find((l) => l.id === value)?.name ?? (newLocationName.trim() || String(value));
      if (key === "arrival_time") return `${value} min early`;
      return String(value);
    };
    const changes: FieldChange[] = Object.entries(fields).map(([key, value]) => ({
      field: labels[key] ?? key,
      before: show(key, anchor[key as keyof BulkFields]),
      after: show(key, value),
    }));
    if (timeChanged) {
      changes.push({
        field: "Time",
        before: `${clock(anchor.start_time)}–${clock(anchor.end_time)}`,
        after: `${startClock}–${endClock}`,
      });
    }
    if (newRule) {
      changes.push({
        field: "Recurrence",
        before: getRecurrenceDescription(head.recurrence_rule!),
        after: getRecurrenceDescription(newRule),
      });
    }
    return changes;
  }

  async function apply(plan: SeriesEditPlan) {
    setSaving(true);
    const { error } = await supabase.rpc("apply_series_edit", {
      p_series_head_id: plan.seriesHeadId,
      p_plan: plan as unknown as Json,
    });
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    // apply_series_edit enqueued one notice for the whole operation (BUG-006).
    toast.success(withNotice("Series updated", await drainNotifications()));
    setPending(null);
    setSaving(false);
    onSave();
  }


  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{scope === "series" ? "Edit entire series" : "Edit this and following events"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {scope === "series"
              ? "Changes apply to every remaining event in this series."
              : `Changes apply to events from ${formatOccurrence(anchor.start_time)} onward.`}{" "}
            Past events aren&apos;t changed, and availability responses and results are kept.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
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
                <span className="text-sm text-muted-foreground">minutes before start</span>
              </div>
            </div>

            {/* Time of day — dates come from the repeat pattern below */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startClock">Start time</Label>
                <Input
                  id="startClock"
                  type="time"
                  step={300}
                  value={startClock}
                  onChange={(e) => setStartClock(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endClock">End time</Label>
                <Input
                  id="endClock"
                  type="time"
                  step={300}
                  value={endClock}
                  onChange={(e) => setEndClock(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            {eventType === "game" && (
              <div className="space-y-4 rounded-md border p-4">
                <h4 className="text-sm font-medium">Game details</h4>
                <div className="space-y-2">
                  <Label htmlFor="opponent">Opponent</Label>
                  <Input id="opponent" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
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
                        <SelectItem value="home">{homeUniform || "Home"}</SelectItem>
                        <SelectItem value="away">{awayUniform || "Away"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Results and scores are edited one event at a time.</p>
              </div>
            )}

            <div className="space-y-4 rounded-md border p-4">
              <h4 className="text-sm font-medium">Recurrence</h4>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={frequencyMode}
                  onValueChange={(v) => setFrequencyMode(v as "weekly" | "biweekly" | "custom")}
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
                      onValueChange={(v) => setCustomInterval(v as "weekly" | "biweekly")}
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
                        const isAnchorDay = idx === anchorDay;
                        const isSelected = customDays.includes(idx) || isAnchorDay;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (isAnchorDay) return;
                              setCustomDays((prev) =>
                                prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]
                              );
                            }}
                            className={`h-8 w-8 rounded-full text-sm font-medium transition-colors ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "border hover:bg-muted text-muted-foreground"
                            } ${isAnchorDay ? "cursor-default" : "cursor-pointer"}`}
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

      {/* Preview before cancelling or adding occurrences */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review changes to the series</DialogTitle>
            <DialogDescription>
              Cancelled events stay on the schedule, marked cancelled, with their responses kept.
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="max-h-80 space-y-3 overflow-y-auto text-sm">
              {pending.changes.length > 0 && (
                <div>
                  <p className="font-medium">What changes</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {pending.changes.map((c) => (
                      <li key={c.field}>
                        {c.field}: {c.before} → {c.after}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <PreviewGroup title="Updated" items={pending.plan.preview.updated} />
              <PreviewGroup title="Cancelled" items={pending.plan.preview.cancelled} />
              <PreviewGroup title="Added" items={pending.plan.preview.added} />
              <PreviewGroup title="Left as is (individually changed or cancelled)" items={pending.plan.preview.unchanged} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
              Back
            </Button>
            <Button onClick={() => pending && apply(pending.plan)} disabled={saving}>
              {saving ? "Saving..." : "Apply changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-medium">
        {title} ({items.length})
      </p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {items.map((iso) => (
          <li key={iso}>{formatOccurrence(iso)}</li>
        ))}
      </ul>
    </div>
  );
}
