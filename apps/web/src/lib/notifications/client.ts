/**
 * Client side of the notification queue (BUG-006).
 *
 * A schedule change enqueues its own notice inside the same transaction, so
 * nothing is lost if this ping never happens — it only makes the send immediate
 * rather than waiting for the daily sweep.
 */

export type DrainSummary = {
  claimed: number;
  results: { jobId: string; status: string; sent: number; failed: number; skipped: number }[];
};

/**
 * Asks the server to send what is waiting. Never throws: the change itself is
 * already saved, and a failed ping only delays the notice.
 */
export async function drainNotifications(): Promise<DrainSummary | null> {
  try {
    const response = await fetch("/api/notifications/drain", { method: "POST" });
    if (!response.ok) return null;
    return (await response.json()) as DrainSummary;
  } catch {
    return null;
  }
}

/** "Sent to 12 · 2 skipped", or null when this change notified nobody. */
export function describeDrain(summary: DrainSummary | null): string | null {
  if (!summary || summary.results.length === 0) return null;

  const totals = summary.results.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
    }),
    { sent: 0, failed: 0, skipped: 0 }
  );

  if (totals.failed > 0) {
    return `Notified ${totals.sent}, ${totals.failed} failed — we'll retry`;
  }
  if (totals.sent === 0) return "No one to notify";
  return totals.skipped > 0
    ? `Notified ${totals.sent} · ${totals.skipped} skipped`
    : `Notified ${totals.sent}`;
}

/** Appends the delivery result to a success message, when there was one. */
export function withNotice(message: string, summary: DrainSummary | null): string {
  const notice = describeDrain(summary);
  return notice ? `${message} — ${notice}` : message;
}
