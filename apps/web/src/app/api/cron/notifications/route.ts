import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { adminClient } from "@/lib/api-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { sendReminders } from "@/lib/notifications/reminders";

/**
 * Daily sweep of the notification queue (BUG-006).
 *
 * Schedule changes are sent the moment they are saved; this catches the ones
 * whose send never happened — a tab closed mid-save, a provider outage, a drain
 * that errored. The reminders run sweeps too, so a stranded notice waits at most
 * about twelve hours on a plan that runs each cron job once a day.
 *
 * It also retries the noon run's reminders that didn't all go out, for events
 * that haven't started (review RR-001). It never starts a new one.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let drained: Awaited<ReturnType<typeof drainNotificationJobs>> | null = null;
  try {
    drained = await drainNotificationJobs(100);
  } catch (error) {
    console.error("Notification sweep failed:", error);
  }

  const reminders = await sendReminders(adminClient(), { retryOnly: true });
  if ("error" in reminders) console.error(`Reminder retry failed: ${reminders.error}`);

  const remindersFailed = "error" in reminders || reminders.failedEvents.length > 0;
  if (!drained || remindersFailed) {
    return NextResponse.json(
      { error: !drained ? "Sweep failed" : "Reminder retry failed", ...(drained ?? {}), reminders },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, ...drained, reminders });
}
