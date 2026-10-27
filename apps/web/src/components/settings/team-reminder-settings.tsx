"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { DEFAULT_REMINDER_SETTINGS, type TeamReminderSettings as Settings } from "@/lib/notifications/reminder-rules";

const TYPES: Array<{ key: keyof Omit<Settings, "enabled">; label: string }> = [
  { key: "remind_practice", label: "Practices" },
  { key: "remind_game", label: "Games" },
  { key: "remind_other", label: "Other events" },
  { key: "remind_tournament", label: "Tournaments" },
];

/**
 * Whether the team's events get the daily reminder, and for which types
 * (team-notification-controls §4.1). Each switch saves as it's flipped; an
 * event's own "Always send" or "Don't send" still wins (D9). Read-only for
 * members who can't edit the team's events.
 */
export function TeamReminderSettings({
  teamId,
  settings,
  canEdit,
}: {
  teamId: string;
  /** The team's row; null when it has none, which means the defaults. */
  settings: Settings | null;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<Settings>(() => pick(settings ?? DEFAULT_REMINDER_SETTINGS));
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function set(key: keyof Settings, on: boolean) {
    const previous = current;
    const next = { ...current, [key]: on };
    setCurrent(next);
    setSaving(true);
    // The whole row, so the first save creates it.
    const { error } = await supabase
      .from("team_reminder_settings")
      .upsert({ team_id: teamId, ...next }, { onConflict: "team_id" });
    setSaving(false);
    if (error) {
      setCurrent(previous);
      toast.error(`Couldn't save: ${error.message}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
        <CardDescription>Reminders are sent once a day, for events in the next 24 hours.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="remind-enabled">Send reminders</Label>
            <p className="text-sm text-muted-foreground">
              An event set to &quot;Always send&quot; or &quot;Don&apos;t send&quot; keeps its own setting.
            </p>
          </div>
          <Switch
            id="remind-enabled"
            aria-label="Send reminders"
            checked={current.enabled}
            disabled={!canEdit || saving}
            onCheckedChange={(on) => set("enabled", on)}
          />
        </div>
        <div className="space-y-2 border-t pt-4">
          {TYPES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`remind-${key}`}>{label}</Label>
              <Switch
                id={`remind-${key}`}
                aria-label={label}
                checked={current[key]}
                disabled={!canEdit || saving || !current.enabled}
                onCheckedChange={(on) => set(key, on)}
              />
            </div>
          ))}
          <p className="text-sm text-muted-foreground">Tournament games follow the Games setting.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function pick(settings: Settings): Settings {
  const { enabled, remind_practice, remind_game, remind_other, remind_tournament } = settings;
  return { enabled, remind_practice, remind_game, remind_other, remind_tournament };
}
