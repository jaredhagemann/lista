"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, DateSelectArg } from "@fullcalendar/core";
import { EventFormDialog } from "./event-form-dialog";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

const eventTypeColors: Record<string, string> = {
  practice: "#2563eb",
  game: "#dc2626",
  other: "#7c3aed",
};

export function ScheduleCalendar({
  events,
  teamId,
  isAdmin,
}: {
  events: Event[];
  teamId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  const calendarEvents = events
    .filter((e) => !e.is_cancelled)
    .map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start_time,
      end: event.end_time,
      backgroundColor: eventTypeColors[event.event_type] ?? "#6b7280",
      borderColor: eventTypeColors[event.event_type] ?? "#6b7280",
      extendedProps: {
        event_type: event.event_type,
        location: event.location,
        description: event.description,
      },
    }));

  const handleDateSelect = useCallback(
    (selectInfo: DateSelectArg) => {
      if (!isAdmin) return;
      setSelectedDate({ start: selectInfo.start, end: selectInfo.end });
      setEditingEvent(null);
      setShowForm(true);
    },
    [isAdmin]
  );

  const handleEventClick = useCallback(
    (clickInfo: EventClickArg) => {
      const eventId = clickInfo.event.id;
      router.push(`/dashboard/schedule/${eventId}`);
    },
    [router]
  );

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setSelectedDate(null);
    setEditingEvent(null);
    router.refresh();
  }, [router]);

  return (
    <div>
      <style>{`
        .fc {
          --fc-border-color: hsl(var(--border));
          --fc-today-bg-color: hsl(var(--accent) / 0.3);
          --fc-page-bg-color: transparent;
          font-family: inherit;
        }
        .fc .fc-button-primary {
          background-color: hsl(var(--primary));
          border-color: hsl(var(--primary));
          font-size: 0.875rem;
        }
        .fc .fc-button-primary:not(:disabled).fc-button-active,
        .fc .fc-button-primary:not(:disabled):active {
          background-color: hsl(var(--primary));
          border-color: hsl(var(--primary));
          opacity: 0.8;
        }
        .fc .fc-toolbar-title {
          font-size: 1.25rem;
          font-weight: 600;
        }
        .fc .fc-event {
          cursor: pointer;
          border-radius: 4px;
          font-size: 0.8rem;
          padding: 1px 4px;
        }
        .fc .fc-daygrid-day-number {
          font-size: 0.875rem;
          padding: 4px 8px;
        }
        .fc th {
          font-weight: 500;
          font-size: 0.8rem;
          text-transform: uppercase;
        }
      `}</style>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        selectable={isAdmin}
        selectMirror={true}
        dayMaxEvents={3}
        events={calendarEvents}
        select={handleDateSelect}
        eventClick={handleEventClick}
        height="auto"
      />

      {showForm && isAdmin && (
        <EventFormDialog
          open={showForm}
          onClose={handleFormClose}
          teamId={teamId}
          defaultStart={selectedDate?.start}
          defaultEnd={selectedDate?.end}
          editingEvent={editingEvent}
        />
      )}
    </div>
  );
}
