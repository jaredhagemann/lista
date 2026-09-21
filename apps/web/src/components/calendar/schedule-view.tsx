"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScheduleCalendar } from "./schedule-calendar";
import { ScheduleList } from "./schedule-list";
import { currentMonthKey, type MonthKey } from "@/lib/events/month-range";

/**
 * The schedule's two tabs (BUG-014, spec §6.1).
 *
 * Neither tab is handed data any more. List is the default and reads one page;
 * the calendar reads the month it is showing, and only once it has been opened —
 * so looking at the list never fetches a month, let alone a history.
 *
 * The selected month lives here rather than in the calendar, so switching to
 * List and back does not send the user to today again.
 */
export function ScheduleView({
  teamId,
  isAdmin,
  timeZone,
  homeUniform,
  awayUniform,
}: {
  teamId: string;
  isAdmin: boolean;
  /** The team's timezone: decides month boundaries and day placement. */
  timeZone?: string | null;
  homeUniform?: string | null;
  awayUniform?: string | null;
}) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState<MonthKey>(() => currentMonthKey(timeZone));
  // Mounting the calendar is what starts its first month query, so it stays
  // unmounted until the tab has been opened at least once.
  const [calendarOpened, setCalendarOpened] = useState(false);

  return (
    <Tabs
      value={view}
      onValueChange={(v) => {
        const next = v as "list" | "calendar";
        if (next === "calendar") setCalendarOpened(true);
        setView(next);
      }}
    >
      <TabsList className="mb-4">
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>
      <TabsContent value="list">
        <ScheduleList teamId={teamId} isAdmin={isAdmin} homeUniform={homeUniform} awayUniform={awayUniform} />
      </TabsContent>
      <TabsContent value="calendar">
        {calendarOpened && (
          <ScheduleCalendar
            // A team switch is a different cache, not a refresh of this one.
            key={teamId}
            teamId={teamId}
            isAdmin={isAdmin}
            timeZone={timeZone}
            month={month}
            onMonthChange={setMonth}
            homeUniform={homeUniform}
            awayUniform={awayUniform}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
