"use client";

import { useState } from "react";
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
import { buildRRule, expandRecurrence } from "@/lib/utils/rrule";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

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
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  defaultStart?: Date;
  defaultEnd?: Date;
  editingEvent?: Event | null;
}) {
  const isEditing = !!editingEvent;
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState(editingEvent?.title ?? "");
  const [eventType, setEventType] = useState<"practice" | "game" | "other">(
    (editingEvent?.event_type as "practice" | "game" | "other") ?? "practice"
  );
  const [location, setLocation] = useState(editingEvent?.location ?? "");
  const [description, setDescription] = useState(
    editingEvent?.description ?? ""
  );
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

  // Recurring event settings
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly">("weekly");
  const [recurUntil, setRecurUntil] = useState("");

  const [loading, setLoading] = useState(false);

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

    const eventData = {
      team_id: teamId,
      title,
      event_type: eventType,
      location: location || null,
      description: description || null,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      created_by: user.id,
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
        daysOfWeek: [startDate.getDay() === 0 ? 6 : startDate.getDay() - 1], // Convert JS day to rrule day
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

      // Expand recurrence and create child events
      const occurrences = expandRecurrence(rruleString, startDate);

      // Skip the first one (it's the parent event itself)
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
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="e.g. Main Field, Complex A"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
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
              <Label htmlFor="description">Notes</Label>
              <Textarea
                id="description"
                placeholder="Any additional details..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

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
