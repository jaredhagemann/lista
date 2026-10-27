"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { teamRemindsType, type EventReminder, type TeamReminderSettings } from "@/lib/notifications/reminder-rules";

const DEFAULT = "default";

/**
 * An event's reminder: the team's default, or its own "Always send" / "Don't
 * send" (team-notification-controls §4.1). The default says what the team's
 * settings mean for this type; if they can't be read, it just says "Team default".
 */
export function ReminderSelect({
  id = "reminder",
  value,
  onChange,
  teamId,
  eventType,
}: {
  id?: string;
  value: EventReminder;
  onChange: (value: EventReminder) => void;
  teamId: string;
  eventType: string;
}) {
  const supabase = createClient();
  // undefined until read; null is a team with no settings row (the defaults).
  const [settings, setSettings] = useState<TeamReminderSettings | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("team_reminder_settings")
          .select("enabled, remind_practice, remind_game, remind_other, remind_tournament")
          .eq("team_id", teamId)
          .maybeSingle();
        if (!cancelled && !error) setSettings(data ?? null);
      } catch {
        // Unread, the option just says "Team default".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, supabase]);

  const teamDefault =
    settings === undefined ? "Team default" : `Team default (${teamRemindsType(eventType, settings) ? "on" : "off"})`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Reminder</Label>
      <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : (v as EventReminder))}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{teamDefault}</SelectItem>
          <SelectItem value="always">Always send</SelectItem>
          <SelectItem value="never">Don&apos;t send</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">Sent once a day, for events in the next 24 hours.</p>
    </div>
  );
}
