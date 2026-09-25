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

export function RsvpButtons({
  eventId,
  profileId,
  initialStatus,
}: {
  eventId: string;
  profileId: string;
  initialStatus: AvailabilityStatus | null;
}) {
  const supabase = createClient();
  const [status, setStatus] = useState<AvailabilityStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);

  async function handleClick(clicked: AvailabilityStatus) {
    setLoading(true);
    const previous = status;
    const next = nextAvailability(status, clicked);

    setStatus(next);
    const { error } = await saveAvailability(supabase, eventId, profileId, next);
    if (error) {
      toast.error(error.message);
      setStatus(previous);
    }

    setLoading(false);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Your availability</p>
      <AvailabilityPicker label="Your availability" status={status} disabled={loading} onChoose={handleClick} />
      <p className="text-xs text-muted-foreground">
        ✓ Available &nbsp;·&nbsp; ? Maybe &nbsp;·&nbsp; ✗ Unavailable
        {status && " · tap again to clear"}
      </p>
    </div>
  );
}
