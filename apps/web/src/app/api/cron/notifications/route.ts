import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";

/**
 * Daily sweep of the notification queue (BUG-006).
 *
 * Schedule changes are sent the moment they are saved; this catches the ones
 * whose send never happened — a tab closed mid-save, a provider outage, a drain
 * that errored. The reminders run sweeps too, so a stranded notice waits at most
 * about twelve hours on a plan that runs each cron job once a day.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await drainNotificationJobs(100);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Notification sweep failed:", error);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
