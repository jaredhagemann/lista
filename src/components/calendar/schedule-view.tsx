"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScheduleCalendar } from "./schedule-calendar";
import { ScheduleList } from "./schedule-list";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

export function ScheduleView({
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
  const [view, setView] = useState<"list" | "calendar">("list");

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as "list" | "calendar")}>
      <TabsList className="mb-4">
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>
      <TabsContent value="list">
        <ScheduleList teamId={teamId} isAdmin={isAdmin} homeUniform={homeUniform} awayUniform={awayUniform} />
      </TabsContent>
      <TabsContent value="calendar">
        <ScheduleCalendar
          events={events}
          teamId={teamId}
          isAdmin={isAdmin}
          homeUniform={homeUniform}
          awayUniform={awayUniform}
        />
      </TabsContent>
    </Tabs>
  );
}
