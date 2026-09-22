/**
 * Stripe delivery bookkeeping (BUG-015).
 *
 * Separate from the handlers on purpose: whether an event has already been
 * dealt with is a different question from what the event means, and only this
 * half needs to know that Stripe replays events, delivers them out of order,
 * and retries anything it is not told to stop retrying.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;

export type EventClaim =
  /** Not seen before, or seen but never finished: do the work. */
  | "process"
  /** Finished on an earlier delivery, side effects included. */
  | "done"
  /** The ledger could not be read or written; the caller must not acknowledge. */
  | "unavailable";

/**
 * Records the event and says whether to process it.
 *
 * A replay is only skipped once it has been *completed*. An attempt that failed
 * half way leaves the row incomplete, and that is precisely what Stripe is
 * retrying, so it runs again.
 */
export async function claimStripeEvent(
  admin: Admin,
  event: { id: string; type: string },
  eventAt: string,
): Promise<EventClaim> {
  const { data: claimed, error } = await admin
    .from("stripe_webhook_events")
    .upsert(
      { event_id: event.id, event_type: event.type, event_created_at: eventAt },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");

  if (error) return "unavailable";
  // Rows came back: this delivery claimed it.
  if (claimed && claimed.length > 0) return "process";

  const { data: prior, error: priorError } = await admin
    .from("stripe_webhook_events")
    .select("completed_at")
    .eq("event_id", event.id)
    .maybeSingle();

  if (priorError) return "unavailable";
  return prior?.completed_at ? "done" : "process";
}

/** Marks the event finished. False means the caller must not acknowledge. */
export async function completeStripeEvent(admin: Admin, eventId: string): Promise<boolean> {
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("event_id", eventId);

  return !error;
}

/**
 * Only apply a billing state if no newer Stripe event already has.
 *
 * A filter rather than a read-then-write, so the comparison and the write are
 * one statement: two deliveries racing cannot both decide they are the newest.
 */
export function notOlderThanStored(eventAt: string): string {
  return `stripe_event_at.is.null,stripe_event_at.lt."${eventAt}"`;
}
