"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  AvailabilityPicker,
  nextAvailability,
  saveAvailability,
  type AvailabilityStatus,
} from "./availability-picker";
import { effectiveAnswer } from "@/lib/availability/effective";

export function RsvpButtons({
  eventId,
  profileId,
  initialStatus,
  onStatusChange,
  answeringFor,
  inheritedStatus,
  inheritedFrom,
}: {
  eventId: string;
  profileId: string;
  /**
   * A player's first name when the picker answers for someone other than
   * whoever the viewer is answering as: after an email answer for another of
   * their players (PR #96 review). Labels it "Zoey's availability".
   */
  answeringFor?: string | null;
  initialStatus: AvailabilityStatus | null;
  /** Told of every change, including a failed save being put back, so the page can show the answer elsewhere. */
  onStatusChange?: (status: AvailabilityStatus | null) => void;
  /**
   * For a game in a tournament: the tournament answer it follows until it has
   * its own (spec §4, Availability), and the tournament's name.
   */
  inheritedStatus?: AvailabilityStatus | null;
  inheritedFrom?: string | null;
}) {
  const supabase = createClient();
  const [status, setStatus] = useState<AvailabilityStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);

  async function handleClick(clicked: AvailabilityStatus) {
    setLoading(true);
    const previous = status;
    const next = nextAvailability(status, clicked);

    setStatus(next);
    onStatusChange?.(next);
    const { error } = await saveAvailability(supabase, eventId, profileId, next);
    if (error) {
      toast.error(error.message);
      setStatus(previous);
      onStatusChange?.(previous);
    }

    setLoading(false);
  }

  const label = answeringFor ? `${answeringFor}'s availability` : "Your availability";
  // The answer shown: this event's own, else the tournament's it follows. A tap
  // sets this event's own answer; tapping it again clears it, back to the
  // tournament's (nextAvailability works on the own answer, not the shown one).
  const shown = effectiveAnswer(status, inheritedFrom ? inheritedStatus : null);
  const whose = answeringFor ? `${answeringFor}'s` : "your";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <AvailabilityPicker label={label} status={shown.status} disabled={loading} onChoose={handleClick} />
      <p className="text-xs text-muted-foreground">
        ✓ Available &nbsp;·&nbsp; ? Maybe &nbsp;·&nbsp; ✗ Unavailable
        {status && " · tap again to clear"}
      </p>
      {inheritedFrom && shown.inherited && (
        <p className="text-xs text-muted-foreground">
          From {whose} {inheritedFrom} answer. Choose an answer to set this game differently.
        </p>
      )}
      {inheritedFrom && status && (
        <p className="text-xs text-muted-foreground">
          Set for this game.
          {inheritedStatus ? ` Tap it again to go back to ${whose} ${inheritedFrom} answer.` : ""}
        </p>
      )}
    </div>
  );
}
