import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { notificationLimiter, rateLimitResponse } from "@/lib/rate-limit";

/**
 * Sends whatever schedule changes are waiting (BUG-006).
 *
 * The database enqueues a job in the same transaction as the change, so the
 * notice is never lost if this call doesn't happen. The app pings this route
 * right after a save so it goes out immediately; the daily cron sweeps up
 * anything a closed tab or a failed provider left behind.
 *
 * Draining is not a privileged act — it sends what a coach's own change already
 * committed — so any signed-in user may trigger it, and claiming is atomic, so
 * two simultaneous pings cannot send the same job twice.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { success } = await notificationLimiter.limit(`drain:${user.id}`);
    if (!success) return rateLimitResponse();
  }

  try {
    const result = await drainNotificationJobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Notification drain failed:", error);
    return NextResponse.json({ error: "Drain failed" }, { status: 500 });
  }
}
