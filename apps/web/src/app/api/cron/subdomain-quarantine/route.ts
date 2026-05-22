import { NextResponse } from "next/server";
import { adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";

/**
 * GET/POST /api/cron/subdomain-quarantine
 *
 * Daily cron (registered in `vercel.json` at `0 2 * * *`): releases any org
 * subdomain that has been in quarantine for more than `QUARANTINE_DAYS`.
 *
 * Background:
 *   When an org downgrades to Free (cancellation or trial expiration) or an
 *   owner clears their subdomain in settings, the subdomain VALUE is kept on
 *   the row and `subdomain_status` is flipped to `'quarantined'`. The UNIQUE
 *   constraint on `organizations.subdomain` then blocks any other org from
 *   claiming the same slug, preventing immediate-takeover squatting of links
 *   that may still be cached, indexed, or in print marketing.
 *
 *   After 180 days the slug is freed: this cron NULLs out `subdomain`,
 *   `subdomain_status`, and `subdomain_quarantined_at`, after which any other
 *   org can register the slug.
 *
 * Auth: Bearer `CRON_SECRET` (same pattern as the other crons). Without a
 * valid secret the route returns 401 before touching the database or Redis.
 *
 * Idempotency:
 *   Released rows have `subdomain_status = NULL`, so they no longer match the
 *   eligibility filter on subsequent runs. A failed update leaves the row
 *   matchable, so the next run retries. Cache invalidation failures are
 *   logged but do not roll back the DB release — the cached tenant entry
 *   will expire on its own TTL, after which any reader gets a fresh DB miss.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const QUARANTINE_DAYS = 180;
const BASE_DOMAIN = "lista.team";

type ReleaseStats = { released: number; failed: number };

async function handler(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = adminClient();
  const cutoff = new Date(
    Date.now() - QUARANTINE_DAYS * MS_PER_DAY,
  ).toISOString();

  const { data: expired, error } = await admin
    .from("organizations")
    .select("id, subdomain")
    .eq("subdomain_status", "quarantined")
    .lt("subdomain_quarantined_at", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stats: ReleaseStats = { released: 0, failed: 0 };

  for (const org of expired ?? []) {
    const { error: updateError } = await admin
      .from("organizations")
      .update({
        subdomain: null,
        subdomain_status: null,
        subdomain_quarantined_at: null,
      })
      .eq("id", org.id);

    if (updateError) {
      stats.failed++;
      console.error(
        `[subdomain-quarantine] release failed for org ${org.id}:`,
        updateError,
      );
      continue;
    }

    // Invalidate the tenant cache for the released hostname so resolveTenant()
    // misses immediately and any pending requests against the freed subdomain
    // get a fresh DB read (which will now show the row no longer holds the
    // slug). A cache-bust failure is non-fatal: the entry expires on its own
    // Redis TTL, and the DB is already authoritative for new requests once
    // any caller bypasses the cache.
    if (org.subdomain) {
      try {
        await invalidateTenantCache(`${org.subdomain}.${BASE_DOMAIN}`);
      } catch (cacheError) {
        console.error(
          `[subdomain-quarantine] cache invalidate failed for ${org.subdomain}.${BASE_DOMAIN}:`,
          cacheError,
        );
      }
    }

    stats.released++;
  }

  return NextResponse.json({ ok: true, ...stats });
}

export const GET = handler;
export const POST = handler;
