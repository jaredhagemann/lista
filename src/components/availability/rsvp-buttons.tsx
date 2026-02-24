"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type AvailabilityStatus = "available" | "maybe" | "unavailable";

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

    if (clicked === status) {
      // Clear response
      setStatus(null);
      const { error } = await supabase
        .from("availability")
        .delete()
        .eq("event_id", eventId)
        .eq("profile_id", profileId);
      if (error) {
        toast.error(error.message);
        setStatus(previous);
      }
    } else {
      // Upsert
      setStatus(clicked);
      const { error } = await supabase.from("availability").upsert(
        { event_id: eventId, profile_id: profileId, status: clicked },
        { onConflict: "event_id,profile_id" }
      );
      if (error) {
        toast.error(error.message);
        setStatus(previous);
      }
    }

    setLoading(false);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Your availability</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={status === "available" ? "default" : "outline"}
          className={
            status === "available"
              ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
              : "border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950"
          }
          disabled={loading}
          onClick={() => handleClick("available")}
          title="Available"
        >
          ✓
        </Button>
        <Button
          size="sm"
          variant={status === "maybe" ? "default" : "outline"}
          className={
            status === "maybe"
              ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
              : "border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
          }
          disabled={loading}
          onClick={() => handleClick("maybe")}
          title="Maybe"
        >
          ?
        </Button>
        <Button
          size="sm"
          variant={status === "unavailable" ? "default" : "outline"}
          className={
            status === "unavailable"
              ? "bg-red-600 hover:bg-red-700 text-white border-red-600"
              : "border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          }
          disabled={loading}
          onClick={() => handleClick("unavailable")}
          title="Unavailable"
        >
          ✗
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        ✓ Available &nbsp;·&nbsp; ? Maybe &nbsp;·&nbsp; ✗ Unavailable
        {status && " · tap again to clear"}
      </p>
    </div>
  );
}
