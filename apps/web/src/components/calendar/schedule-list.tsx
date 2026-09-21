"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventFormDialog } from "./event-form-dialog";
import { toast } from "sonner";
import { pinnedStartRule } from "@/lib/events/series-edit";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import { fetchEventPage, type EventCursor } from "@/lib/events/queries";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type EventWithLocation = Event & {
  locations: { name: string; address: string | null } | null;
};
type TypeFilter = "all" | "game" | "practice" | "other";
type PageSize = 30 | 50 | 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEventTitle(event: EventWithLocation): string {
  if (event.event_type !== "game") return event.title;
  const opponent = event.opponent;
  if (!opponent) return event.title;
  const prefix =
    event.home_away === "home"
      ? `Home vs ${opponent}`
      : event.home_away === "away"
        ? `Away @ ${opponent}`
        : opponent;
  if (event.score_for != null && event.score_against != null) {
    return `${prefix} · ${event.score_for}–${event.score_against}`;
  }
  return prefix;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  practice: {
    label: "Practice",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0",
  },
  game: {
    label: "Game",
    className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0",
  },
  other: {
    label: "Other",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border-0",
  },
};

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduleList({
  teamId,
  isAdmin,
  homeUniform,
  awayUniform,
}: {
  teamId: string;
  isAdmin: boolean;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const router = useRouter();
  // Held in state so its identity is stable: this client is a dependency of the
  // data effect, and a fresh object each render would re-run it forever.
  const [supabase] = useState(() => createClient());

  // Filter / pagination state
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(30);

  // Data state
  const [events, setEvents] = useState<EventWithLocation[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Where each visited page started. Next continues from the current page's
  // cursor; Previous returns to a saved one. Offsets shift when an event is
  // deleted behind them, silently skipping one that still exists (BUG-014).
  const cursorHistory = useRef<(EventCursor | null)[]>([null]);
  const nextCursor = useRef<EventCursor | null>(null);

  // Dialog state
  const [deletingEvent, setDeletingEvent] = useState<EventWithLocation | null>(null);
  const [cancellingEvent, setCancellingEvent] = useState<EventWithLocation | null>(null);
  const [restoringEvent, setRestoringEvent] = useState<EventWithLocation | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    // The cursor for this page was saved when the user navigated to it.
    const cursor = cursorHistory.current[page - 1] ?? null;

    try {
      const result = await fetchEventPage(supabase, {
        query: {
          teamId,
          fromInclusive: showAll ? undefined : startOfToday(),
          eventType: typeFilter === "all" ? undefined : typeFilter,
          includeCancelled: true,
        },
        pageSize,
        cursor,
        projection: "list",
      });

      setEvents(result.items as unknown as EventWithLocation[]);
      setHasNext(result.hasNext);
      nextCursor.current = result.nextCursor;
    } catch {
      // An empty result and a failed read look identical once rendered, so the
      // list says which this is.
      setEvents([]);
      setHasNext(false);
      nextCursor.current = null;
      setLoadError(true);
      toast.error("Failed to load events");
    }
    setLoading(false);
  }, [supabase, teamId, typeFilter, showAll, page, pageSize]);

  useEffect(() => {
    void fetchEvents(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [fetchEvents]);

  /**
   * A cursor only means anything within one query. Changing what is being asked
   * for — or changing the data underneath — sends the user back to page 1 with
   * the history cleared, rather than continuing from a position in a result set
   * that no longer exists.
   */
  function restart() {
    cursorHistory.current = [null];
    nextCursor.current = null;
    setPage(1);
  }

  function applyTypeFilter(value: TypeFilter) {
    setTypeFilter(value);
    restart();
  }

  function applyShowAll(value: boolean) {
    setShowAll(value);
    restart();
  }

  function applyPageSize(value: PageSize) {
    setPageSize(value);
    restart();
  }

  function goToNextPage() {
    // Remember where this page began so Previous can come back to it.
    cursorHistory.current[page] = nextCursor.current;
    setPage(page + 1);
  }

  function goToPreviousPage() {
    setPage(Math.max(1, page - 1));
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleDuplicate(event: EventWithLocation) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("events").insert({
      id: crypto.randomUUID(),
      team_id: event.team_id,
      title: event.title,
      event_type: event.event_type,
      start_time: event.start_time,
      end_time: event.end_time,
      location_id: event.location_id,
      arrival_time: event.arrival_time,
      notes: event.notes,
      opponent: event.opponent,
      home_away: event.home_away,
      uniform: event.uniform,
      created_by: user.id,
      // Intentionally excluded: game_result, score_for, score_against,
      // recurrence_rule, parent_event_id
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Event duplicated");
      // A new event can land on any page of the ordered result.
      restart();
      fetchEvents();
    }
  }

  async function handleCancel(event: EventWithLocation) {
    const { error } = await supabase
      .from("events")
      .update({ is_cancelled: true })
      .eq("id", event.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(withNotice("Event cancelled", await drainNotifications()));
      setCancellingEvent(null);
      fetchEvents();
    }
  }

  async function handleRestore(event: EventWithLocation) {
    const { error } = await supabase
      .from("events")
      .update({ is_cancelled: false })
      .eq("id", event.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(withNotice("Event restored", await drainNotifications()));
      setRestoringEvent(null);
      fetchEvents();
    }
  }

  // Deletes only this occurrence; the first occurrence of a series hands the
  // series on to the next one (BUG-009).
  async function handleDelete(event: EventWithLocation) {
    const { error } = await supabase.rpc("delete_event_occurrence", {
      p_event_id: event.id,
      p_promoted_head_rule: event.recurrence_rule ? pinnedStartRule(event) : undefined,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(withNotice("Event deleted", await drainNotifications()));
      setDeletingEvent(null);
      fetchEvents();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Type filter */}
          <div className="flex items-center rounded-md border p-0.5 gap-0.5">
            {(["all", "game", "practice", "other"] as TypeFilter[]).map((t) => (
              <button
                key={t}
                onClick={() => applyTypeFilter(t)}
                className={`px-3 py-1 rounded text-sm capitalize transition-colors ${
                  typeFilter === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Upcoming / All toggle */}
          <div className="flex items-center rounded-md border p-0.5 gap-0.5">
            <button
              onClick={() => applyShowAll(false)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                !showAll
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Upcoming
            </button>
            <button
              onClick={() => applyShowAll(true)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                showAll
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
          </div>
        </div>

        {isAdmin && (
          <Button size="sm" onClick={() => setShowCreateForm(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">New Event</span>
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
              <TableHead className="hidden sm:table-cell">Time</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              {isAdmin && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 5 : 4}
                  className="h-32 text-center text-muted-foreground"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 5 : 4}
                  className="h-32 text-center text-muted-foreground"
                >
                  {typeFilter !== "all" ? (
                    <span>
                      No {typeFilter} events found.{" "}
                      <button
                        className="underline"
                        onClick={() => applyTypeFilter("all")}
                      >
                        Clear filter
                      </button>
                    </span>
                  ) : !showAll ? (
                    <span>
                      No upcoming events.{" "}
                      {isAdmin && (
                        <button
                          className="underline"
                          onClick={() => setShowCreateForm(true)}
                        >
                          Create one
                        </button>
                      )}
                    </span>
                  ) : (
                    "No events scheduled yet."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => {
                const start = new Date(event.start_time);
                const end = new Date(event.end_time);
                const badge = TYPE_BADGE[event.event_type] ?? TYPE_BADGE.other;

                const arrivalTime =
                  event.arrival_time != null
                    ? new Date(
                        start.getTime() - event.arrival_time * 60 * 1000
                      ).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : null;

                return (
                  <TableRow
                    key={event.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      router.push(`/dashboard/schedule/${event.id}`)
                    }
                  >
                    {/* Title + type badge */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={
                              event.is_cancelled
                                ? "line-through text-muted-foreground"
                                : "font-medium"
                            }
                          >
                            {getEventTitle(event)}
                          </span>
                          {event.is_cancelled && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Cancelled
                            </Badge>
                          )}
                        </div>
                        <Badge className={`w-fit text-xs ${badge.className}`}>
                          {badge.label}
                        </Badge>
                        {/* Date + time shown inline on mobile */}
                        <span className="sm:hidden text-xs text-muted-foreground">
                          {start.toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          ·{" "}
                          {start.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-sm">
                      {start.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-sm">
                      <div>
                        {start.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        –{" "}
                        {end.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      {arrivalTime && (
                        <div className="text-xs text-muted-foreground">
                          Arrive by {arrivalTime}
                        </div>
                      )}
                    </TableCell>

                    {/* Location */}
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {event.locations?.name ?? "—"}
                    </TableCell>

                    {/* Actions */}
                    {isAdmin && (
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(`/dashboard/schedule/${event.id}?edit=true`)
                              }
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDuplicate(event)}
                            >
                              Duplicate
                            </DropdownMenuItem>
                            {!event.is_cancelled ? (
                              <DropdownMenuItem
                                onClick={() => setCancellingEvent(event)}
                              >
                                Cancel event
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setRestoringEvent(event)}
                              >
                                Restore
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeletingEvent(event)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      {!loading && !loadError && (events.length > 0 || page > 1) && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => applyPageSize(Number(v) as PageSize)}
            >
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {/* No "of N": an exact count is a second query on every page load,
                and its answer is stale by the time it arrives. Next is enabled
                by a single lookahead row instead (BUG-014, spec §4.3). */}
            <span>Page {page}</span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page === 1}
              onClick={goToPreviousPage}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={!hasNext}
              onClick={goToNextPage}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create dialog */}
      {showCreateForm && (
        <EventFormDialog
          open={showCreateForm}
          onClose={() => {
            setShowCreateForm(false);
            fetchEvents();
          }}
          teamId={teamId}
          homeUniform={homeUniform}
          awayUniform={awayUniform}
        />
      )}

      {/* Restore confirmation */}
      <AlertDialog
        open={!!restoringEvent}
        onOpenChange={(open) => !open && setRestoringEvent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{restoringEvent ? getEventTitle(restoringEvent) : ""}&rdquo; will be restored and no longer marked as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => restoringEvent && handleRestore(restoringEvent)}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirmation */}
      <AlertDialog
        open={!!cancellingEvent}
        onOpenChange={(open) => !open && setCancellingEvent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{cancellingEvent ? getEventTitle(cancellingEvent) : ""}&rdquo; will be marked as cancelled. Team members will still be able to see it on the schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancellingEvent && handleCancel(cancellingEvent)}
            >
              Cancel event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deletingEvent}
        onOpenChange={(open) => !open && setDeletingEvent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deletingEvent ? getEventTitle(deletingEvent) : ""}&rdquo; will be permanently deleted. This cannot be undone.{deletingEvent && (deletingEvent.parent_event_id || deletingEvent.recurrence_rule) ? " Other events in the series are not affected." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingEvent && handleDelete(deletingEvent)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
