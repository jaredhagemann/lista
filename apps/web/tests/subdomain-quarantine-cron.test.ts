/**
 * Unit tests for the daily subdomain-quarantine release cron
 * (GET/POST /api/cron/subdomain-quarantine).
 *
 * Background: when a club org downgrades to Free or an owner clears their
 * subdomain in settings, the subdomain value is RETAINED on the row and
 * `subdomain_status` is flipped to `'quarantined'`. The UNIQUE constraint on
 * `organizations.subdomain` then prevents any other org from claiming the
 * same slug for 180 days — the anti-squatting window. This cron releases the
 * slug after the window expires.
 *
 * Why each branch matters:
 *   - CRON_SECRET: the cron mutates billing-adjacent state and invalidates
 *     Redis cache entries. An unauthenticated call must not touch either.
 *   - Eligibility filter: `subdomain_status = 'quarantined'` AND
 *     `subdomain_quarantined_at < now - 180d`. Both clauses are load-bearing
 *     — without the status filter, active subdomains would be released; without
 *     the timestamp filter, the protection window would not be honoured.
 *   - Release payload: sets `subdomain`, `subdomain_status`, and
 *     `subdomain_quarantined_at` all to NULL. NULLing `subdomain` is what
 *     actually frees the slot (the UNIQUE constraint blocks reuse of a
 *     non-null value regardless of status).
 *   - Cache invalidation: the tenant resolver caches hostname → tenant lookups
 *     in Redis with a long TTL. Without an explicit bust, the freed hostname
 *     would still resolve to the old tenant until TTL expiry.
 *   - Per-org isolation: a DB or cache failure on one org must not block the
 *     rest of the batch — flagged in stats.failed and the route keeps going.
 *
 * All Supabase and Redis calls are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  type UpdateCall = {
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ column: string; value: unknown }>;
  };
  const updateCalls: UpdateCall[] = [];

  type SelectCall = {
    table: string;
    columns: string;
    filters: Array<{ op: string; column: string; value?: unknown }>;
  };
  const selectCalls: SelectCall[] = [];

  // Per-table FIFO queue of select results (matches the trial-expiration
  // test harness so this file stays familiar to future maintainers).
  const selectQueues: Record<string, unknown[]> = {};

  const makeSelectChain = (
    val: unknown,
    call: SelectCall,
  ): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const record =
      (op: string) =>
      (column: string, value?: unknown): Record<string, unknown> => {
        call.filters.push({ op, column, value });
        return chain;
      };
    const chain: Record<string, unknown> = {
      eq: record("eq"),
      gte: record("gte"),
      lte: record("lte"),
      lt: record("lt"),
      in: record("in"),
      is: record("is"),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  // Optional per-table override for the top-level .select() error.
  const selectErrors: Record<string, unknown> = {};

  // Per-call (in FIFO order) update errors for the organizations table.
  const updateErrorsByRow: unknown[] = [];

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: (columns: string) => {
      const call: SelectCall = { table, columns, filters: [] };
      selectCalls.push(call);
      const errOverride = selectErrors[table];
      if (errOverride !== undefined) {
        const promise = Promise.resolve({ data: null, error: errOverride });
        const noopRecord = () => noop;
        const noop: Record<string, unknown> = {
          eq: noopRecord,
          gte: noopRecord,
          lte: noopRecord,
          lt: noopRecord,
          in: noopRecord,
          is: noopRecord,
          single: () => promise,
          maybeSingle: () => promise,
          then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) =>
            promise.then(r, j),
        };
        // Bind self-references after declaration so they all resolve to `noop`.
        Object.assign(noop, {
          eq: noopRecord,
          gte: noopRecord,
          lte: noopRecord,
          lt: noopRecord,
          in: noopRecord,
          is: noopRecord,
        });
        return noop;
      }
      const queue = selectQueues[table];
      const val = queue && queue.length > 0 ? queue.shift() : null;
      return makeSelectChain(val ?? null, call);
    },
    update: (values: Record<string, unknown>) => {
      const call: UpdateCall = { table, values, filters: [] };
      updateCalls.push(call);
      const eqChain: Record<string, unknown> = {
        eq: (column: string, value: unknown) => {
          call.filters.push({ column, value });
          const err = updateErrorsByRow.shift() ?? null;
          return {
            then: (
              res: (v: unknown) => unknown,
              rej?: (e: unknown) => unknown,
            ) => Promise.resolve({ data: null, error: err }).then(res, rej),
            eq: eqChain.eq,
          };
        },
      };
      return eqChain;
    },
  }));

  const invalidateTenantCache = vi.fn();

  return {
    updateCalls,
    selectCalls,
    selectQueues,
    selectErrors,
    updateErrorsByRow,
    mockFrom,
    invalidateTenantCache,
  };
});

vi.mock("@/lib/api-auth", () => ({
  adminClient: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: mocks.invalidateTenantCache,
}));

// ── Route under test (after mocks) ────────────────────────────────────────────

import { GET, POST } from "@/app/api/cron/subdomain-quarantine/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON_SECRET = "test_cron_secret";
const NOW = new Date("2026-05-20T02:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const QUARANTINE_DAYS = 180;

function makeRequest(opts: { secret?: string; method?: "GET" | "POST" } = {}) {
  const headers = new Headers();
  if (opts.secret !== undefined) {
    headers.set("authorization", `Bearer ${opts.secret}`);
  }
  return new Request("http://localhost:3000/api/cron/subdomain-quarantine", {
    method: opts.method ?? "POST",
    headers,
  });
}

function resetState() {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  mocks.selectCalls.length = 0;
  Object.keys(mocks.selectQueues).forEach((k) => delete mocks.selectQueues[k]);
  Object.keys(mocks.selectErrors).forEach((k) => delete mocks.selectErrors[k]);
  mocks.updateErrorsByRow.length = 0;
  // Default happy-path: no eligible orgs.
  mocks.selectQueues.organizations = [[]];
  mocks.invalidateTenantCache.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetState();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("subdomain-quarantine cron — authentication", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No DB or cache side effects on auth failure — load-bearing.
    expect(mocks.mockFrom).not.toHaveBeenCalled();
    expect(mocks.invalidateTenantCache).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong Bearer secret", async () => {
    const res = await POST(makeRequest({ secret: "wrong" }));
    expect(res.status).toBe(401);
    expect(mocks.mockFrom).not.toHaveBeenCalled();
  });

  it("accepts a valid Bearer secret and returns empty stats when no orgs are eligible", async () => {
    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      released: 0,
      failed: 0,
    });
  });

  it("supports GET as well as POST (Vercel cron uses GET by default)", async () => {
    const res = await GET(makeRequest({ secret: CRON_SECRET, method: "GET" }));
    expect(res.status).toBe(200);
  });
});

// ── Eligibility query ─────────────────────────────────────────────────────────

describe("subdomain-quarantine cron — eligibility query", () => {
  it("filters on subdomain_status = 'quarantined' AND subdomain_quarantined_at < (now − 180d)", async () => {
    mocks.selectQueues.organizations = [[]];

    await POST(makeRequest({ secret: CRON_SECRET }));

    const select = mocks.selectCalls.find(
      (c) => c.table === "organizations",
    );
    expect(select).toBeDefined();

    // Status filter — without this, ACTIVE subdomains would be released.
    expect(select!.filters).toContainEqual({
      op: "eq",
      column: "subdomain_status",
      value: "quarantined",
    });

    // Timestamp filter — must be strictly LT a cutoff exactly 180 days before
    // `now`. The cutoff is computed from Date.now(), pinned by fake timers.
    const expectedCutoff = new Date(
      NOW.getTime() - QUARANTINE_DAYS * MS_PER_DAY,
    ).toISOString();
    const ltFilter = select!.filters.find(
      (f) => f.op === "lt" && f.column === "subdomain_quarantined_at",
    );
    expect(ltFilter?.value).toBe(expectedCutoff);
  });

  it("selects the id and subdomain columns (id for the update WHERE, subdomain for cache bust)", async () => {
    mocks.selectQueues.organizations = [[]];

    await POST(makeRequest({ secret: CRON_SECRET }));

    const select = mocks.selectCalls.find(
      (c) => c.table === "organizations",
    );
    // The cache-bust call needs the subdomain string, and the per-row update
    // needs the id — both must be present in the projection.
    expect(select?.columns).toContain("id");
    expect(select?.columns).toContain("subdomain");
  });

  it("returns 500 when the select itself fails (transient DB outage)", async () => {
    mocks.selectErrors.organizations = { message: "connection refused" };

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "connection refused" });
    expect(mocks.updateCalls).toHaveLength(0);
    expect(mocks.invalidateTenantCache).not.toHaveBeenCalled();
  });
});

// ── Release behaviour ─────────────────────────────────────────────────────────

describe("subdomain-quarantine cron — release behaviour", () => {
  it("NULLs subdomain, subdomain_status, and subdomain_quarantined_at on the matched row", async () => {
    mocks.selectQueues.organizations = [
      [{ id: "org-1", subdomain: "old-club" }],
    ];

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    expect(mocks.updateCalls).toHaveLength(1);
    const update = mocks.updateCalls[0];
    expect(update.table).toBe("organizations");
    // All three columns must be NULL — clearing only the status would leave
    // the value in place and the UNIQUE constraint would keep blocking reuse.
    expect(update.values).toEqual({
      subdomain: null,
      subdomain_status: null,
      subdomain_quarantined_at: null,
    });
    // WHERE id = the released org — never any other filter, never a bulk update.
    expect(update.filters).toEqual([{ column: "id", value: "org-1" }]);
  });

  it("invalidates the Redis tenant cache for the released hostname (slug + base domain)", async () => {
    mocks.selectQueues.organizations = [
      [{ id: "org-1", subdomain: "old-club" }],
    ];

    await POST(makeRequest({ secret: CRON_SECRET }));

    // The cache key is hostname-scoped; the cron must reconstruct
    // `<slug>.lista.team` so any reader still hitting the cache misses
    // immediately and re-reads from the (now-cleared) DB row.
    expect(mocks.invalidateTenantCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith(
      "old-club.lista.team",
    );
  });

  it("releases multiple eligible orgs in a single run and reports the count", async () => {
    mocks.selectQueues.organizations = [
      [
        { id: "org-1", subdomain: "alpha" },
        { id: "org-2", subdomain: "beta" },
        { id: "org-3", subdomain: "gamma" },
      ],
    ];

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 3, failed: 0 });
    expect(mocks.updateCalls).toHaveLength(3);
    expect(mocks.invalidateTenantCache).toHaveBeenCalledTimes(3);
    expect(mocks.invalidateTenantCache).toHaveBeenNthCalledWith(
      1,
      "alpha.lista.team",
    );
    expect(mocks.invalidateTenantCache).toHaveBeenNthCalledWith(
      2,
      "beta.lista.team",
    );
    expect(mocks.invalidateTenantCache).toHaveBeenNthCalledWith(
      3,
      "gamma.lista.team",
    );
  });

  it("skips the cache bust when the row has no subdomain value (defensive — would be a partial-state row)", async () => {
    // A row matched the eligibility filter but `subdomain` is somehow NULL
    // (e.g. a prior partial release). The DB update still runs to harmonise
    // the columns, but no hostname can be constructed for cache invalidation.
    mocks.selectQueues.organizations = [
      [{ id: "org-partial", subdomain: null }],
    ];

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);

    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.invalidateTenantCache).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, released: 1, failed: 0 });
  });

  it("counts a DB update failure under failed and continues with the next org", async () => {
    mocks.selectQueues.organizations = [
      [
        { id: "org-fail", subdomain: "broken" },
        { id: "org-ok", subdomain: "fine" },
      ],
    ];
    // First update errors, second succeeds.
    mocks.updateErrorsByRow.push(
      { message: "update conflict" },
      null,
    );

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 1, failed: 1 });

    // Failed-row cache must NOT have been invalidated (row state in the DB
    // is unchanged, so busting the cache would only force a redundant fetch).
    expect(mocks.invalidateTenantCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith("fine.lista.team");
  });

  it("still counts the release when the cache bust throws (cache miss is non-fatal)", async () => {
    mocks.selectQueues.organizations = [
      [{ id: "org-1", subdomain: "old-club" }],
    ];
    mocks.invalidateTenantCache.mockRejectedValueOnce(
      new Error("redis down"),
    );

    const res = await POST(makeRequest({ secret: CRON_SECRET }));
    expect(res.status).toBe(200);
    // The DB release already happened — the row is no longer eligible, so
    // counting this as `released` is correct. Stale cache entries expire on
    // their own TTL, and the DB is authoritative once the cache misses.
    expect(await res.json()).toEqual({ ok: true, released: 1, failed: 0 });
  });
});
