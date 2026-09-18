/**
 * D3's delivery vocabulary (BUG-006): what is attempted, what is skipped, and
 * what a job's overall status is. Skipped and failed must never be conflated —
 * a coach reading "2 failed" should mean two deliveries the system could not
 * make, not two families who turned email off.
 */

import { describe, it, expect } from "vitest";
import {
  planDeliveries,
  summarizeDeliveries,
  jobSubject,
  templateAction,
  type DeliveryOutcome,
  type NotificationJob,
  type Recipient,
} from "@/lib/notifications/dispatch";

function recipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    profileId: crypto.randomUUID(),
    emails: ["parent@example.com"],
    pushTargets: [{ kind: "expo", token: "ExponentPushToken[abc]" }],
    emailEnabled: true,
    pushEnabled: true,
    ...overrides,
  };
}

function job(overrides: Partial<NotificationJob> = {}): NotificationJob {
  return {
    id: crypto.randomUUID(),
    team_id: crypto.randomUUID(),
    event_id: crypto.randomUUID(),
    action: "cancelled",
    occurrence_count: 1,
    attempts: 0,
    snapshot: {
      title: "Practice",
      event_type: "practice",
      start_time: "2026-09-18T23:00:00.000Z",
      end_time: "2026-09-19T00:30:00.000Z",
      arrival_time: 15,
      location_id: null,
      location_name: "Islay Park",
      is_cancelled: true,
    },
    ...overrides,
  };
}

function outcome(status: DeliveryOutcome["status"]): DeliveryOutcome {
  return { profile_id: crypto.randomUUID(), channel: "email", target: "x@example.com", status, reason: null };
}

describe("planning deliveries", () => {
  it("plans one delivery per address and per push target", () => {
    const planned = planDeliveries([
      recipient({
        emails: ["mum@example.com", "dad@example.com"],
        pushTargets: [
          { kind: "expo", token: "ExponentPushToken[abc]" },
          { kind: "web", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
        ],
      }),
    ]);

    expect(planned.filter((p) => p.channel === "email").map((p) => p.target)).toEqual([
      "mum@example.com",
      "dad@example.com",
    ]);
    expect(planned.filter((p) => p.channel === "push")).toHaveLength(2);
    expect(planned.every((p) => p.skipReason === undefined)).toBe(true);
  });

  it("tells a guardian once, however many of their children are on the team", () => {
    const shared = { emails: ["dad@example.com"], pushTargets: [{ kind: "expo" as const, token: "ExponentPushToken[dad]" }] };
    const planned = planDeliveries([recipient(shared), recipient(shared)]);

    expect(planned.filter((p) => p.channel === "email" && !p.skipReason)).toHaveLength(1);
    expect(planned.filter((p) => p.channel === "push" && !p.skipReason)).toHaveLength(1);
  });

  it("skips a channel the recipient turned off, and says why", () => {
    const planned = planDeliveries([recipient({ emailEnabled: false, pushEnabled: false })]);

    expect(planned).toHaveLength(2);
    expect(planned.every((p) => p.skipReason === "opted_out")).toBe(true);
    expect(planned.every((p) => p.target === "")).toBe(true);
  });

  it("skips a channel that cannot reach the recipient at all", () => {
    const planned = planDeliveries([recipient({ emails: [], pushTargets: [] })]);

    expect(planned.map((p) => p.skipReason)).toEqual(["no_address", "no_subscription"]);
  });
});

describe("job status", () => {
  it("is sent when every attempt succeeded", () => {
    expect(summarizeDeliveries([outcome("sent"), outcome("sent")])).toEqual({
      status: "sent",
      sent: 2,
      failed: 0,
      skipped: 0,
    });
  });

  it("is partial when some attempts failed", () => {
    expect(summarizeDeliveries([outcome("sent"), outcome("failed")]).status).toBe("partial");
  });

  it("is failed when every attempt failed", () => {
    expect(summarizeDeliveries([outcome("failed"), outcome("failed")]).status).toBe("failed");
  });

  it("counts opted-out recipients as skipped, not failed, and still reads as sent", () => {
    const summary = summarizeDeliveries([outcome("sent"), outcome("skipped"), outcome("skipped")]);

    expect(summary).toEqual({ status: "sent", sent: 1, failed: 0, skipped: 2 });
  });

  it("is sent, not failed, when everyone opted out", () => {
    expect(summarizeDeliveries([outcome("skipped")]).status).toBe("sent");
  });
});

describe("what the notice says", () => {
  it("names one event, or how many a bulk operation touched", () => {
    expect(jobSubject(job())).toBe("Cancelled: Practice");
    expect(jobSubject(job({ action: "updated", occurrence_count: 12 }))).toBe(
      "Updated: Practice — 12 events"
    );
  });

  it("describes a deleted event to families as a cancellation", () => {
    expect(templateAction("deleted")).toBe("cancelled");
    expect(jobSubject(job({ action: "deleted" }))).toBe("Cancelled: Practice");
  });

  it("still describes an event that no longer exists, from the snapshot", () => {
    const deleted = job({ action: "deleted", event_id: null });

    expect(deleted.snapshot.title).toBe("Practice");
    expect(deleted.snapshot.location_name).toBe("Islay Park");
    expect(jobSubject(deleted)).toContain("Practice");
  });
});
