import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drainNotificationJobs } from "@/lib/notifications/worker";
import { sendReminders } from "@/lib/notifications/reminders";
import type { Database } from "@/types/database";

// Vercel Cron: runs daily, sends reminders for events happening in the next 24h
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role for cron to bypass RLS
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const run = await sendReminders(supabase);
  if ("error" in run) {
    return NextResponse.json({ error: run.error }, { status: 500 });
  }

  // Sweep up schedule-change notices whose immediate send never happened — a
  // closed tab, a provider outage (BUG-006). /api/cron/notifications sweeps at
  // midnight too; doing it here as well costs one query and halves how long a
  // stranded notice can sit, because this plan allows only one run per day per
  // cron job.
  let drained = { claimed: 0 };
  try {
    drained = await drainNotificationJobs(100);
  } catch (err) {
    console.error("Notification drain failed:", err);
  }

  // A failed event fails the run, so the cron's monitoring sees it; the rest were still sent.
  const { failedEvents, partialEvents } = run;
  return NextResponse.json(
    {
      success: failedEvents.length === 0,
      eventsProcessed: run.eventsProcessed,
      notificationsSent: run.notificationsSent,
      notificationJobsDrained: drained.claimed,
      ...(failedEvents.length > 0 ? { failedEvents } : {}),
      ...(partialEvents.length > 0 ? { partialEvents } : {}),
    },
    { status: failedEvents.length > 0 ? 500 : 200 }
  );
}
