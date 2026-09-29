"use client";

import { Button } from "@/components/ui/button";

import { AVAILABILITY, type AvailabilityStatus } from "@/lib/availability/status";

export { AVAILABILITY, nextAvailability, saveAvailability, type AvailabilityStatus } from "@/lib/availability/status";

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
