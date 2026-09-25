"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";

export type AvailabilityStatus = "available" | "maybe" | "unavailable";

export const AVAILABILITY: Record<
  AvailabilityStatus,
  { label: string; symbol: string; icon: string; selected: string; idle: string }
> = {
  available: {
    label: "Available",
    symbol: "✓",
    icon: "text-green-700 dark:text-green-400",
    selected: "bg-green-600 hover:bg-green-700 text-white border-green-600",
    idle: "border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950",
  },
  maybe: {
    label: "Maybe",
    symbol: "?",
    icon: "text-amber-600 dark:text-amber-400",
    selected: "bg-amber-500 hover:bg-amber-600 text-white border-amber-500",
    idle: "border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950",
  },
  unavailable: {
    label: "Unavailable",
    symbol: "✗",
    icon: "text-red-600 dark:text-red-400",
    selected: "bg-red-600 hover:bg-red-700 text-white border-red-600",
    idle: "border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950",
  },
};

/** The answer a tap on `clicked` leads to: tapping the current answer clears it. */
export function nextAvailability(current: AvailabilityStatus | null, clicked: AvailabilityStatus) {
  return clicked === current ? null : clicked;
}

/** Saves one person's answer for an event; `null` clears it. */
export async function saveAvailability(
  supabase: SupabaseClient,
  eventId: string,
  profileId: string,
  status: AvailabilityStatus | null
): Promise<{ error: { message: string } | null }> {
  if (status === null) {
    return supabase.from("availability").delete().eq("event_id", eventId).eq("profile_id", profileId);
  }
  return supabase
    .from("availability")
    .upsert({ event_id: eventId, profile_id: profileId, status }, { onConflict: "event_id,profile_id" });
}

/**
 * The ✓ ? ✗ picker: "Your availability", and a coach answering for a teammate.
 * The chosen answer is pressed; tapping it again clears it.
 */
export function AvailabilityPicker({
  label,
  status,
  disabled,
  onChoose,
  compact = false,
}: {
  /** Names the group, e.g. "Your availability" or "Availability for Ava Smith". */
  label: string;
  status: AvailabilityStatus | null;
  disabled?: boolean;
  onChoose: (clicked: AvailabilityStatus) => void;
  /** Smaller buttons, for a row in the responses list. */
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`flex shrink-0 ${compact ? "gap-1" : "gap-2"}`}>
      {(Object.keys(AVAILABILITY) as AvailabilityStatus[]).map((s) => (
        <Button
          key={s}
          size="sm"
          variant={status === s ? "default" : "outline"}
          className={`${status === s ? AVAILABILITY[s].selected : AVAILABILITY[s].idle} ${compact ? "h-7 w-7 px-0 text-xs" : ""}`}
          disabled={disabled}
          onClick={() => onChoose(s)}
          title={AVAILABILITY[s].label}
          aria-label={AVAILABILITY[s].label}
          aria-pressed={status === s}
        >
          {AVAILABILITY[s].symbol}
        </Button>
      ))}
    </div>
  );
}
