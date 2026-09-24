"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { timeZoneChoices } from "@/lib/events/event-timezone";
import { formatZoneName } from "@/lib/notifications/event-time";

/**
 * The zone an event's times are entered in (BUG-010, D5).
 *
 * A native select: the list is long, and the browser's own control handles
 * type-to-find and small screens better than a custom popover.
 */
export function TimeZoneSelect({
  id = "timeZone",
  value,
  onChange,
  teamTimeZone,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  teamTimeZone?: string | null;
}) {
  const choices = useMemo(() => timeZoneChoices([value, teamTimeZone]), [value, teamTimeZone]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Time zone</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {choices.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, " ")}
            {zone === teamTimeZone ? " (team default)" : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Times are in {formatZoneName(value)}
        {teamTimeZone && value !== teamTimeZone ? ", not the team's usual zone" : ""}.
      </p>
    </div>
  );
}
