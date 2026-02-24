"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { EventFormDialog } from "./event-form-dialog";
import { getRecurrenceDescription } from "@/lib/utils/rrule";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

type EventWithLocation = Event & {
  locations: { name: string; address: string | null } | null;
};

export function EventDetail({
  event,
  isAdmin,
  creatorName,
}: {
  event: EventWithLocation;
  isAdmin: boolean;
  creatorName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const eventTypeColor: Record<string, string> = {
    practice: "bg-blue-100 text-blue-800",
    game: "bg-red-100 text-red-800",
    other: "bg-purple-100 text-purple-800",
  };

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
                  {event.title}
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
                  onClick={() => setShowEdit(true)}
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

          {event.event_type === "game" && (event.opponent || event.home_away || event.uniform || event.game_result) && (
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
                    {event.score_for != null && event.score_against != null && (
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

          {isAdmin && !event.is_cancelled && (
            <div className="border-t pt-4">
              <Button variant="outline" onClick={handleCancel}>
                Cancel this event
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showEdit && (
        <EventFormDialog
          open={showEdit}
          onClose={() => {
            setShowEdit(false);
            router.refresh();
          }}
          teamId={event.team_id!}
          editingEvent={event}
        />
      )}

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
