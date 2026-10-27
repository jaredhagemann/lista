import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendExpoPushNotification, isDeadTokenError } from "@/lib/notifications/expo-push";
import {
  summarizeDeliveries,
  type DeliveryOutcome,
  type PlannedDelivery,
  type PushTarget,
} from "@/lib/notifications/dispatch";

type Db = SupabaseClient<Database>;
type PushPayload = { title: string; body: string; url: string };

/**
 * Sends what planDeliveries planned, one delivery at a time, and says what
 * happened to each: sent, failed, or skipped with its reason. Shared by the
 * notice worker and the reminders job, so both log alike. `onOutcome` hears of
 * each as it happens, so a caller can log it before the next send.
 */
export async function sendPlanned(
  db: Db,
  planned: PlannedDelivery[],
  send: { email: (item: PlannedDelivery) => Promise<void>; push: PushPayload },
  onOutcome?: (outcome: DeliveryOutcome) => Promise<void>
): Promise<DeliveryOutcome[]> {
  const outcomes: DeliveryOutcome[] = [];
  for (const item of planned) {
    const outcome = await sendOne(db, item, send);
    outcomes.push(outcome);
    await onOutcome?.(outcome);
  }
  return outcomes;
}

async function sendOne(
  db: Db,
  item: PlannedDelivery,
  send: { email: (item: PlannedDelivery) => Promise<void>; push: PushPayload }
): Promise<DeliveryOutcome> {
  if (item.skipReason) return { ...toRow(item), status: "skipped", reason: item.skipReason };
  try {
    if (item.channel === "email") {
      await send.email(item);
    } else {
      await sendPush(item.push!, send.push);
    }
    return { ...toRow(item), status: "sent", reason: null };
  } catch (err) {
    // A token the service says is dead never works again: drop it rather
    // than failing against it on every message (BUG-007).
    if (isDeadTokenError(err)) {
      await db.from("push_subscriptions").delete().eq("expo_push_token", item.target);
    }
    return {
      ...toRow(item),
      status: "failed",
      reason: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
    };
  }
}

/** Records each delivery against its job, and the job's overall state. */
export async function recordOutcomes(db: Db, jobId: string, outcomes: DeliveryOutcome[]) {
  if (outcomes.length > 0) {
    await db.from("notification_deliveries").insert(outcomes.map((o) => ({ job_id: jobId, ...o })));
  }
  return finishJob(db, jobId, outcomes);
}

/** Sets a job's overall state from all its deliveries, and returns the tally. */
export async function finishJob(db: Db, jobId: string, outcomes: DeliveryOutcome[]) {
  const summary = summarizeDeliveries(outcomes);
  await db
    .from("notification_jobs")
    .update({
      status: summary.status,
      sent_at: new Date().toISOString(),
      last_error: summary.failed > 0 ? `${summary.failed} deliveries failed` : null,
    })
    .eq("id", jobId);

  return summary;
}

function toRow(item: { profile_id: string; channel: "email" | "push"; target: string }) {
  return { profile_id: item.profile_id, channel: item.channel, target: item.target || null } as {
    profile_id: string;
    channel: "email" | "push";
    target: string;
  };
}

function sendPush(target: PushTarget, payload: PushPayload) {
  if (target.kind === "expo") return sendExpoPushNotification(target.token, payload);
  return sendPushNotification({ endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth }, payload);
}
