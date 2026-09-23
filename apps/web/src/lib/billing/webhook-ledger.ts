/**
 * Stripe delivery bookkeeping (BUG-015).
 *
 * Separate from the handlers on purpose: whether an event has already been
 * dealt with is a different question from what the event means, and only this
 * half needs to know that Stripe replays events and retries anything it is not
 * told to stop retrying.
 *
 * Ordering is deliberately *not* handled here. Stripe does not guarantee it and
 * says `created` must not be used to decide it, so the handlers ask Stripe for
 * the subscription's current state rather than trying to sequence snapshots.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;

/**
 * How long a claim is trusted before another delivery may take it.
 *
 * Long enough that a live handler is never overtaken — these run in seconds —
 * and short enough that a process killed mid-event is retried the same day
 * rather than leaving the event stuck forever.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export type EventClaim =
  /** This delivery owns the event: do the work. */
  | "process"
  /** Finished on an earlier delivery, side effects included. */
  | "done"
  /** Another delivery owns it right now. Not ours to do, nor to acknowledge. */
  | "busy"
  /** The ledger could not be read or written; the caller must not acknowledge. */
  | "unavailable";

/**
 * Takes exclusive ownership of an event, or explains why not.
 *
 * Insert-or-take: a first delivery inserts the row and owns it. A later one
 * finds the row and may only take over if the event never finished *and* the
 * previous claim has gone stale — which is what makes an abandoned attempt
 * recoverable without letting two live handlers run the same event.
 */
export async function claimStripeEvent(
  admin: Admin,
  event: { id: string; type: string },
  eventAt: string,
  now: Date = new Date(),
): Promise<EventClaim> {
  const claimedAt = now.toISOString();

  const { data: inserted, error } = await admin
    .from("stripe_webhook_events")
    .upsert(
      {
        event_id: event.id,
        event_type: event.type,
        event_created_at: eventAt,
        claimed_at: claimedAt,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");

  if (error) return "unavailable";
  if (inserted && inserted.length > 0) return "process";

  // The row already exists. Take it over only if it is unfinished and its claim
  // has expired; the filters do that in one statement so two deliveries racing
  // cannot both win.
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString();
  const { data: taken, error: takeError } = await admin
    .from("stripe_webhook_events")
    .update({ claimed_at: claimedAt })
    .eq("event_id", event.id)
    .is("completed_at", null)
    .or(`claimed_at.is.null,claimed_at.lt."${staleBefore}"`)
    .select("event_id");

  if (takeError) return "unavailable";
  if (taken && taken.length > 0) return "process";

  // Not ours. Either it is finished, or someone else is working on it.
  const { data: prior, error: priorError } = await admin
    .from("stripe_webhook_events")
    .select("completed_at")
    .eq("event_id", event.id)
    .maybeSingle();

  if (priorError) return "unavailable";
  return prior?.completed_at ? "done" : "busy";
}

/**
 * Gives the claim back after a failed attempt.
 *
 * Without this, a delivery that fails cleanly would keep holding its claim and
 * answer 409 to its own retry until the lease expired — turning a transient
 * database error into five minutes of refusals. The lease exists for handlers
 * that *die*; one that knows it failed should say so and step aside.
 *
 * Best effort: if this write fails too, the lease is still there to recover.
 */
export async function releaseStripeEvent(admin: Admin, eventId: string): Promise<void> {
  await admin
    .from("stripe_webhook_events")
    .update({ claimed_at: null })
    .eq("event_id", eventId)
    .is("completed_at", null);
}

/** Marks the event finished. False means the caller must not acknowledge. */
export async function completeStripeEvent(admin: Admin, eventId: string): Promise<boolean> {
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("event_id", eventId);

  return !error;
}
