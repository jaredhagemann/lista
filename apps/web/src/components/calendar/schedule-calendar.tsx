"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventFormDialog } from "./event-form-dialog";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone, updateTeamTimeZone } from "@/lib/events/team-timezone";
import { fetchEventRange, type CalendarEventRow } from "@/lib/events/queries";
import { createMonthLoader, type MonthLoader } from "@/lib/events/month-cache";
import {
  addMonths,
  currentMonthKey,
  dayKeyOf,
  daysInMonth,
  firstWeekdayOf,
  monthLabelOf,
  monthRange,
  type MonthKey,
} from "@/lib/events/month-range";

const eventTypeColors: Record<string, { bg: string; text: string }> = {
  practice: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  game: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300" },
  other: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
};

const eventDotColors: Record<string, string> = {
  practice: "bg-blue-600",
  game: "bg-green-600",
  other: "bg-purple-600",
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_EVENTS = 2;

/**
 * The month grid (BUG-014, spec §6.3).
 *
 * It used to be handed every event the team had ever held and filter them in
 * memory, so opening the schedule read the whole history — and past the API's
 * row cap, the events it dropped were the future ones.
 *
 * It now reads the month it is showing, keeps a few neighbouring months, and
 * fetches the previous and next month quietly once the visible one has arrived.
 * Month boundaries and day placement both use the team's timezone, so an event
 * can never land in a cell the query did not cover.
 */
export function ScheduleCalendar({
  teamId,
  isAdmin,
  timeZone,
  month,
  onMonthChange,
  homeUniform,
  awayUniform,
}: {
  teamId: string;
  isAdmin: boolean;
  timeZone?: string | null;
  month: MonthKey;
  onMonthChange: (month: MonthKey) => void;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const router = useRouter();
  // Held in state so its identity is stable: this client is a dependency of the
  // data effect, and a fresh object each render would re-run it forever.
  const [supabase] = useState(() => createClient());

  const [events, setEvents] = useState<CalendarEventRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [savingZone, setSavingZone] = useState(false);

  // Only knowable on the client: reading it during render would use the
  // server's zone and then disagree with the browser after hydration.
  const [viewerZone, setViewerZone] = useState<string | null>(null);
  useEffect(() => {
    setViewerZone(browserTimeZone()); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // A team that has never set one: fall back to the viewer's zone rather than
  // UTC, and say so below.
  const teamZoneMissing = !timeZone;
  const gridZone = timeZone ?? viewerZone;
  // Nothing is placed until the zone is known, so events cannot be drawn on one
  // day and then moved to another a moment later.
  const zoneResolved = !teamZoneMissing || viewerZone !== null;
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Bumped to ask for the visible month again: a retry, or a write that emptied
  // the cache.
  const [reloadToken, setReloadToken] = useState(0);

  // A cache belongs to one team and one zone: different boundaries mean
  // different months, so a zone arriving after mount builds a new loader rather
  // than reusing months fetched for the wrong range. The parent also remounts
  // the calendar on a team switch, so one identity's cache is never read by
  // another (spec §9); writes empty it in place.
  const loader: MonthLoader<CalendarEventRow> = useMemo(
    () =>
      createMonthLoader<CalendarEventRow>({
        read: (key) => {
          const range = monthRange(key, gridZone);
          return fetchEventRange(supabase, {
            query: {
              teamId,
              fromInclusive: range.fromInclusive,
              toExclusive: range.toExclusive,
              // Cancelled events stay hidden on the grid, as before.
              includeCancelled: false,
            },
            projection: "calendar",
          });
        },
      }),
    [supabase, teamId, gridZone]
  );

  useEffect(() => {
    // Without a zone the month boundaries are unknown, so nothing is fetched yet.
    if (!zoneResolved) return;

    // Still showing the month this effect ran for. Navigating away or emptying
    // the cache makes any result that arrives afterwards irrelevant.
    let showingThisMonth = true;
    const startedAt = loader.generation();

    const cached = loader.peek(month);
    if (cached) {
      // Synchronous on purpose: a month already in memory renders in this pass
      // rather than flashing a loading state. One extra render is the price of
      // instant navigation between recently visited months.
      setEvents(cached); // eslint-disable-line react-hooks/set-state-in-effect
      setLoading(false);
      setFailed(false);

      // Old enough that someone may have moved an event since: show what is
      // known and check quietly. A failed check leaves the known rows alone.
      if (loader.isStale(month)) {
        loader
          .revalidate(month)
          .then((rows) => {
            if (!showingThisMonth || startedAt !== loader.generation()) return;
            setEvents(rows);
          })
          .catch(() => undefined);
      }
      return;
    }

    // Never leave the previous month's events under a new month's label.
    setEvents(null);
    setLoading(true);
    setFailed(false);

    loader
      .load(month)
      .then((rows) => {
        if (!showingThisMonth || startedAt !== loader.generation()) return;
        setEvents(rows);
        setLoading(false);

        // Neighbours, once the visible month is on screen. A failure here is
        // invisible: selecting that month later is an ordinary load.
        void loader.prefetch(addMonths(month, -1));
        void loader.prefetch(addMonths(month, 1));
      })
      .catch(() => {
        if (!showingThisMonth || startedAt !== loader.generation()) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      showingThisMonth = false;
    };
  }, [month, loader, reloadToken, zoneResolved]);

  useEffect(() => {
    function checkOnFocus() {
      if (!loader.isStale(month)) return;
      const startedAt = loader.generation();
      loader
        .revalidate(month)
        .then((rows) => {
          if (startedAt !== loader.generation()) return;
          setEvents(rows);
        })
        .catch(() => undefined);
    }

    window.addEventListener("focus", checkOnFocus);
    return () => window.removeEventListener("focus", checkOnFocus);
  }, [loader, month]);

  const todayKey = zoneResolved ? dayKeyOf(new Date(), gridZone) : "";
  const monthLabel = monthLabelOf(month, gridZone);
  const totalDays = daysInMonth(month);
  const startDayOfWeek = firstWeekdayOf(month, gridZone);

  // Day cells keyed by the same zone the query used.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const event of events ?? []) {
      const key = dayKeyOf(event.start_time, gridZone);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events, gridZone]);

  function dayKeyFor(day: number) {
    return `${month}-${String(day).padStart(2, "0")}`;
  }

  function handleDayClick(day: number) {
    if (!isAdmin) return;
    // The grid's day is what the user clicked, whatever zone the browser is in.
    setSelectedDate(dayKeyFor(day));
    setShowForm(true);
  }

  function handleEventClick(e: React.MouseEvent, eventId: string) {
    e.stopPropagation();
    router.push(`/dashboard/schedule/${eventId}`);
  }

  function handleFormClose() {
    setShowForm(false);
    setSelectedDate(null);
    // A new event can belong to any cached month, so the cache goes.
    loader.invalidate();
    setReloadToken((token) => token + 1);
    router.refresh();
  }

  return (
    <div>
      {/* Header — navigation stays usable while a month is loading or failed */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold ml-2">{monthLabel}</h2>
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMonthChange(currentMonthKey(gridZone))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => {
              // Asked for explicitly: read this month again whatever its age.
              loader.invalidate();
              setReloadToken((token) => token + 1);
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedDate(null);
                setShowForm(true);
              }}
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">New Event</span>
            </Button>
          )}
        </div>
      </div>

      {teamZoneMissing && zoneResolved && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground">
              This team has no timezone set, so dates are shown in your device&apos;s zone
              ({gridZone}). Reminder emails and notifications will use UTC until it is set.
              {!isAdmin && " Ask a coach or manager to set the team's timezone."}
            </p>
            {isAdmin && gridZone && (
              <Button
                variant="outline"
                size="sm"
                disabled={savingZone}
                onClick={async () => {
                  setSavingZone(true);
                  const result = await updateTeamTimeZone(supabase, teamId, gridZone);
                  setSavingZone(false);
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  // Boundaries and day placement both change, so every cached
                  // month is now wrong.
                  loader.invalidate();
                  toast.success(`Team timezone set to ${gridZone}`);
                  router.refresh();
                }}
              >
                {savingZone ? "Saving…" : `Use ${gridZone}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {failed ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-2">
              <p className="font-medium text-destructive">Couldn&apos;t load {monthLabel}</p>
              <p className="text-sm text-muted-foreground">
                Some events are missing, so the grid would be wrong. Other months are
                unaffected.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {DAYS_OF_WEEK.map((day) => (
              <div
                key={day}
                className="py-2 text-center text-xs font-medium text-muted-foreground uppercase"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: startDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-24 border-b border-r bg-muted/20" />
            ))}

            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              const key = dayKeyFor(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const isToday = key === todayKey;
              const hasMore = dayEvents.length > MAX_VISIBLE_EVENTS;
              const visibleEvents = hasMore ? dayEvents.slice(0, MAX_VISIBLE_EVENTS) : dayEvents;
              const remainingCount = dayEvents.length - MAX_VISIBLE_EVENTS;

              return (
                <div
                  key={day}
                  data-day={key}
                  className={`min-h-24 border-b border-r p-1 transition-colors ${
                    isAdmin ? "cursor-pointer hover:bg-accent/50" : ""
                  } ${isToday ? "bg-accent/30" : ""}`}
                  onClick={() => handleDayClick(day)}
                >
                  <div
                    className={`text-sm mb-1 ${
                      isToday
                        ? "inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold"
                        : "pl-1 pt-0.5 text-muted-foreground"
                    }`}
                  >
                    {day}
                  </div>

                  {/* Desktop: event badges */}
                  <div className="hidden sm:flex flex-col gap-0.5">
                    {visibleEvents.map((event) => {
                      const colors = eventTypeColors[event.event_type] ?? eventTypeColors.other;
                      return (
                        <button
                          key={event.id}
                          onClick={(e) => handleEventClick(e, event.id)}
                          className={`w-full text-left text-[11px] leading-tight px-1.5 py-0.5 rounded truncate ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                        >
                          {event.title}
                        </button>
                      );
                    })}
                    {hasMore && (
                      <span className="text-[11px] text-muted-foreground pl-1.5">
                        +{remainingCount} more
                      </span>
                    )}
                  </div>

                  {/* Mobile: coloured dots */}
                  <div className="flex sm:hidden flex-wrap gap-1 px-0.5">
                    {dayEvents.map((event) => {
                      const dotColor = eventDotColors[event.event_type] ?? eventDotColors.other;
                      return (
                        <button
                          key={event.id}
                          onClick={(e) => handleEventClick(e, event.id)}
                          className={`size-2 rounded-full ${dotColor}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && isAdmin && (
        <EventFormDialog
          open={showForm}
          onClose={handleFormClose}
          teamId={teamId}
          teamTimeZone={timeZone}
          defaultDate={selectedDate ?? undefined}
          homeUniform={homeUniform}
          awayUniform={awayUniform}
        />
      )}
    </div>
  );
}
