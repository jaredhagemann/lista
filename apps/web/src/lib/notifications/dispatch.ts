/**
 * Turning a notification job into per-recipient deliveries (BUG-006, decision D3).
 *
 * The planning here is deliberately free of IO so the D3 rules can be tested
 * directly: who is skipped rather than failed, what a job's overall status is,
 * and what a notice about an event that no longer exists says.
 *
 * Recipient resolution reaches the whole team, which the old fan-out could not:
 * it ran under the caller's own RLS, so other people's push tokens were
 * invisible to it (BUG-007). The worker runs as the service role instead.
 */

import type { FieldChange } from "@/lib/notifications/email";

export type JobAction = "created" | "updated" | "cancelled" | "restored" | "deleted" | "message";

export type EventSnapshot = {
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string;
  arrival_time: number | null;
  location_id: string | null;
  location_name: string | null;
  is_cancelled: boolean | null;
  /** The event's own zone (BUG-010). Absent from jobs queued before event zones. */
  timezone?: string | null;
};

export type NotificationJob = {
  id: string;
  team_id: string;
  event_id: string | null;
  action: JobAction;
  /** An event's details, or a chat message's — see ChatSnapshot. */
  snapshot: EventSnapshot;
  occurrence_count: number;
  attempts: number;
  kind?: "event" | "chat";
  recipient_profile_ids?: string[] | null;
  /** Who caused this notice. For chat, they are never told about it. */
  created_by?: string | null;
};

/** What a chat job carries instead of an event snapshot. */
export type ChatSnapshot = {
  title: string;
  body: string;
  url: string;
};

/** A team member as the worker sees them, with the addresses that can reach them. */
export type Recipient = {
  profileId: string;
  /** Addresses to email: a managed child resolves to their guardians'. */
  emails: string[];
  /** Web-push subscriptions and Expo tokens, the member's own or their guardians'. */
  pushTargets: PushTarget[];
  emailEnabled: boolean;
  pushEnabled: boolean;
};

export type PushTarget =
  | { kind: "expo"; token: string }
  | { kind: "web"; endpoint: string; p256dh: string; auth: string };

export type PlannedDelivery = {
  profile_id: string;
  channel: "email" | "push";
  target: string;
  /** Present only for a delivery that will not be attempted. */
  skipReason?: string;
  push?: PushTarget;
};

export type DeliveryOutcome = {
  profile_id: string;
  channel: "email" | "push";
  target: string;
  status: "sent" | "failed" | "skipped";
  reason: string | null;
};

/**
 * What the worker will attempt, and what it will not.
 *
 * A recipient who turned a channel off is **skipped**, and so is one the channel
 * cannot reach — a member with no guardian email, say. Neither is a failure: D3
 * asks for those to be reported separately, because a coach reading "2 failed"
 * should mean two deliveries the system could not make.
 */
export function planDeliveries(
  recipients: Recipient[],
  channels: ("email" | "push")[] = ["email", "push"]
): PlannedDelivery[] {
  const planned: PlannedDelivery[] = [];
  // A guardian who is also on the team, or who has two children on it, is one
  // person: one notice per address and per device, not one per membership.
  const seen = new Set<string>();

  for (const r of recipients) {
    if (!channels.includes("email")) {
      // Chat has no per-message email (D2), so there is nothing to record.
    } else if (!r.emailEnabled) {
      planned.push({ profile_id: r.profileId, channel: "email", target: "", skipReason: "opted_out" });
    } else if (r.emails.length === 0) {
      planned.push({ profile_id: r.profileId, channel: "email", target: "", skipReason: "no_address" });
    } else {
      for (const email of r.emails) {
        if (seen.has(`email:${email}`)) continue;
        seen.add(`email:${email}`);
        planned.push({ profile_id: r.profileId, channel: "email", target: email });
      }
    }

    if (!channels.includes("push")) {
      // Nothing to do.
    } else if (!r.pushEnabled) {
      planned.push({ profile_id: r.profileId, channel: "push", target: "", skipReason: "opted_out" });
    } else if (r.pushTargets.length === 0) {
      // Not every family installs the app; that is not a delivery failure.
      planned.push({ profile_id: r.profileId, channel: "push", target: "", skipReason: "no_subscription" });
    } else {
      for (const push of r.pushTargets) {
        const target = push.kind === "expo" ? push.token : push.endpoint;
        if (seen.has(`push:${target}`)) continue;
        seen.add(`push:${target}`);
        planned.push({ profile_id: r.profileId, channel: "push", target, push });
      }
    }
  }

  return planned;
}

/**
 * The job's overall state, in D3's vocabulary. "Sent" means the delivery service
 * accepted it, never that anyone read it.
 */
export function summarizeDeliveries(outcomes: DeliveryOutcome[]): {
  status: "sent" | "partial" | "failed";
  sent: number;
  failed: number;
  skipped: number;
} {
  const sent = outcomes.filter((o) => o.status === "sent").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  // Nothing to send — everyone opted out or is unreachable — is not a failure.
  const status = failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";
  return { status, sent, failed, skipped };
}

// ── What the notice says ──────────────────────────────────────────────────────

const ACTION_WORDS: Record<JobAction, string> = {
  created: "New",
  updated: "Updated",
  cancelled: "Cancelled",
  restored: "Back on",
  deleted: "Cancelled",
  message: "Message",
};

/**
 * Subject line for a job. A bulk operation says how many events it touched, so
 * one notice can stand for twelve occurrences (D3 batching).
 */
export function jobSubject(job: NotificationJob): string {
  const word = ACTION_WORDS[job.action];
  if (job.occurrence_count > 1) {
    return `${word}: ${job.snapshot.title} — ${job.occurrence_count} events`;
  }
  return `${word}: ${job.snapshot.title}`;
}

/**
 * The email action the existing templates understand. A deleted event is
 * described to families as a cancellation: from their side it is the same news,
 * and the snapshot is all that is left of the event.
 */
export function templateAction(action: JobAction): "created" | "updated" | "cancelled" {
  switch (action) {
    case "created":
      return "created";
    case "cancelled":
    case "deleted":
      return "cancelled";
    default:
      return "updated";
  }
}

/** Changes to list in a bulk notice, when the job covers more than one event. */
export function bulkChanges(job: NotificationJob): FieldChange[] {
  return [
    {
      field: "Events affected",
      before: "",
      after: `${job.occurrence_count} occurrences of ${job.snapshot.title}`,
    },
  ];
}
