"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MoreHorizontal, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useNavigate } from "@/components/layout/navigation-progress";
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
import { gameTitle, uniformOf, type TeamDisplay } from "@/lib/events/game-display";
import { UniformLabel } from "@/components/events/uniform-label";
import { eventTimeZone } from "@/lib/events/event-timezone";
import { browserTimeZone } from "@/lib/events/team-timezone";
import { formatEventTime, formatEventTimeRange, formatShortEventDate } from "@/lib/notifications/event-time";
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
  timeZone,
  team,
}: {
  teamId: string;
  isAdmin: boolean;
  /** The team's zone, for events from before event zones and new events' default. */
  timeZone?: string | null;
  /** Names games and shows their uniforms (spec: game-display-and-uniform-colors). */
  team: TeamDisplay;
}) {
  const { navigate, pendingHref } = useNavigate();
  const titleOf = (event: EventWithLocation) => gameTitle(event, team.name);
  const [viewerZone] = useState(() => browserTimeZone() ?? "UTC");
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

  // Everything a cursor depends on. A page from one identity means nothing in
  // another: a team's cursor would skip the next team's earliest events.
  const identity = `${teamId}|${typeFilter}|${showAll}|${pageSize}`;
  const loadedIdentity = useRef(identity);

  // Bumped whenever a request is superseded. A result that arrives after its
  // generation has passed is dropped — aborting alone cannot un-resolve a
  // request already on its way back (spec §9).
  const requestGeneration = useRef(0);

  // Dialog state
  const [deletingEvent, setDeletingEvent] = useState<EventWithLocation | null>(null);
  const [cancellingEvent, setCancellingEvent] = useState<EventWithLocation | null>(null);
  const [restoringEvent, setRestoringEvent] = useState<EventWithLocation | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchEvents = useCallback(async () => {
    const generation = ++requestGeneration.current;
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

      // Superseded while it was in flight: another filter, another team, another
      // page. Its rows and its cursor both belong to a question nobody is asking.
      if (generation !== requestGeneration.current) return;

      setEvents(result.items as unknown as EventWithLocation[]);
      setHasNext(result.hasNext);
      nextCursor.current = result.nextCursor;
    } catch {
      if (generation !== requestGeneration.current) return;
      // An empty result and a failed read look identical once rendered, so the
      // list says which this is.
      setEvents([]);
      setHasNext(false);
      nextCursor.current = null;
      setLoadError(true);
      toast.error("Failed to load events");
    }
    if (generation === requestGeneration.current) setLoading(false);
  }, [supabase, teamId, typeFilter, showAll, page, pageSize]);

  useEffect(() => {
    // A different team (or filter, or page size) is a different result set, so
    // the saved cursors and the page number go with it. Without this, switching
    // teams asks for team B using team A's cursor and skips B's earliest events.
    if (loadedIdentity.current !== identity) {
      loadedIdentity.current = identity;
      cursorHistory.current = [null];
      nextCursor.current = null;
      if (page !== 1) {
        setPage(1); // eslint-disable-line react-hooks/set-state-in-effect
        return;
      }
    }
    void fetchEvents();
  }, [fetchEvents, identity, page]);

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
      timezone: event.timezone,
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
      p_promoted_head_rule: event.recurrence_rule
        ? pinnedStartRule(event, eventTimeZone(event, timeZone, viewerZone))
        : undefined,
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
                className={`px-3 py-1 rounded text-sm transition-colors ${
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
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <p className="font-medium text-destructive">Couldn&apos;t load events</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This is a failed request, not an empty schedule.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void fetchEvents()}
                  >
                    Try again
                  </Button>
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
                const badge = TYPE_BADGE[event.event_type] ?? TYPE_BADGE.other;
                // Shown in the event's own zone, labeled, wherever the viewer is (BUG-010).
                const zone = eventTimeZone(event, timeZone, viewerZone);
                const date = formatShortEventDate(event.start_time, zone);

                const arrivalTime =
                  event.arrival_time != null
                    ? formatEventTime(new Date(start.getTime() - event.arrival_time * 60 * 1000), zone)
                    : null;

                const href = `/dashboard/schedule/${event.id}`;
                // Marked from the click until the event's page is up.
                const opening = pendingHref?.startsWith(href) ?? false;

                return (
                  <TableRow
                    key={event.id}
                    aria-busy={opening}
                    className={`cursor-pointer hover:bg-muted/50 ${opening ? "bg-muted/50 opacity-70" : ""}`}
                    onClick={() => navigate(href)}
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
                            {titleOf(event)}
                          </span>
                          {opening && (
                            <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
                          )}
                          {event.is_cancelled && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Cancelled
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={`w-fit text-xs ${badge.className}`}>
                            {badge.label}
                          </Badge>
                          {event.event_type === "game" && <UniformLabel uniform={uniformOf(event.uniform, team)} />}
                        </div>
                        {/* Date + time shown inline on mobile */}
                        <span className="sm:hidden text-xs text-muted-foreground">
                          {date} · {formatEventTime(event.start_time, zone)}
                        </span>
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-sm">
                      {date}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-sm">
                      <div>{formatEventTimeRange(event.start_time, event.end_time, zone)}</div>
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
                              aria-label="Event actions"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(`/dashboard/schedule/${event.id}?edit=true`)
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
          teamTimeZone={timeZone}
          team={team}
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
              &ldquo;{restoringEvent ? titleOf(restoringEvent) : ""}&rdquo; will be restored and no longer marked as cancelled.
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
              &ldquo;{cancellingEvent ? titleOf(cancellingEvent) : ""}&rdquo; will be marked as cancelled. Team members will still be able to see it on the schedule.
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
              &ldquo;{deletingEvent ? titleOf(deletingEvent) : ""}&rdquo; will be permanently deleted. This cannot be undone.{deletingEvent && (deletingEvent.parent_event_id || deletingEvent.recurrence_rule) ? " Other events in the series are not affected." : ""}
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
