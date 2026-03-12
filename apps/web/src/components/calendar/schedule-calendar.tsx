"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventFormDialog } from "./event-form-dialog";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

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

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function ScheduleCalendar({
  events,
  teamId,
  isAdmin,
  homeUniform,
  awayUniform,
}: {
  events: Event[];
  teamId: string;
  isAdmin: boolean;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  const today = new Date();

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const goToPrevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  };

  const goToNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  };

  const goToToday = () => {
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  // Build calendar grid data
  const { daysInMonth, startDayOfWeek } = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = new Date(year, month, 1).getDay();
    return { daysInMonth, startDayOfWeek };
  }, [currentMonth]);

  // Group non-cancelled events by day
  const eventsByDay = useMemo(() => {
    const map = new Map<number, Event[]>();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    for (const event of events) {
      if (event.is_cancelled) continue;
      const start = new Date(event.start_time);
      if (start.getFullYear() === year && start.getMonth() === month) {
        const day = start.getDate();
        const list = map.get(day) ?? [];
        list.push(event);
        map.set(day, list);
      }
    }
    return map;
  }, [events, currentMonth]);

  const handleDayClick = (day: number) => {
    if (!isAdmin) return;
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    setSelectedDate({ start: date, end: nextDay });
    setShowForm(true);
  };

  const handleEventClick = (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation();
    router.push(`/dashboard/schedule/${eventId}`);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedDate(null);
    router.refresh();
  };

  const MAX_VISIBLE_EVENTS = 2;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPrevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextMonth}>
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold ml-2">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => {
              setSelectedDate(null);
              setShowForm(true);
            }}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">New Event</span>
            </Button>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
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

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells for padding before first day */}
          {Array.from({ length: startDayOfWeek }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="min-h-24 border-b border-r bg-muted/20"
            />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayEvents = eventsByDay.get(day) ?? [];
            const isToday = isSameDay(
              new Date(
                currentMonth.getFullYear(),
                currentMonth.getMonth(),
                day
              ),
              today
            );
            const hasMore = dayEvents.length > MAX_VISIBLE_EVENTS;
            const visibleEvents = hasMore
              ? dayEvents.slice(0, MAX_VISIBLE_EVENTS)
              : dayEvents;
            const remainingCount = dayEvents.length - MAX_VISIBLE_EVENTS;

            return (
              <div
                key={day}
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

                {/* Desktop: show event badges */}
                <div className="hidden sm:flex flex-col gap-0.5">
                  {visibleEvents.map((event) => {
                    const colors =
                      eventTypeColors[event.event_type] ?? eventTypeColors.other;
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

                {/* Mobile: show colored dots */}
                <div className="flex sm:hidden flex-wrap gap-1 px-0.5">
                  {dayEvents.map((event) => {
                    const dotColor =
                      eventDotColors[event.event_type] ?? eventDotColors.other;
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

      {showForm && isAdmin && (
        <EventFormDialog
          open={showForm}
          onClose={handleFormClose}
          teamId={teamId}
          defaultStart={selectedDate?.start}

          homeUniform={homeUniform}
          awayUniform={awayUniform}
        />
      )}
    </div>
  );
}
