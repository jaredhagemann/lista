/**
 * Scale verification for the pagination work (BUG-014, spec §13).
 *
 * Not part of any suite that runs on its own: it seeds up to 100,000 events and
 * needs the local stack. Run it deliberately:
 *
 *   pnpm exec vitest run --config vitest.config.rls.mts tests/scale
 *
 * The spec asks for "deterministic structural goals rather than inventing a
 * production latency SLA", so the assertions are structural — how many requests
 * are sent, how many rows and bytes come back, what the plan does — while the
 * timings are recorded and printed rather than asserted. A test that fails when
 * a laptop is busy teaches nobody anything.
 *
 * Everything is read through the same repository functions the components use,
 * signed in as an ordinary player, through a fetch that counts every request and
 * weighs every response. Costs are measured, not inferred from row counts, and a
 * service-role read would skip the policies that make up much of the cost.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "../rls/helpers";
import { fetchEventPage, fetchEventRange, type CalendarEventRow, type EventCursor } from "@/lib/events/queries";
import { fetchResponsesForEvents, fetchTeamRoster } from "@/lib/availability/queries";
import { createMonthLoader } from "@/lib/events/month-cache";
import { addMonths, monthKeyOf, monthRange } from "@/lib/events/month-range";

const TEAM = "5ca1e000-0000-0000-0000-000000000002";
const ORG_SLUG = "scale-check-fixture";
const EMAIL = "scale-check@fixture.local";
const PASSWORD = "scale-check-password-123!";
const ZONE = "America/Los_Angeles";
const DAY_MS = 864e5;
const FULL_SIZE = 100_000;

let user: SupabaseClient;
let callerProfileId: string;
let authUserId: string;
/** Captured from a real traversal, and explained later exactly as sent. */
let deepCursor: EventCursor | null = null;

type Measurement = { label: string; ms: number; rows: number; requests: number; kib: number };
const measurements: Measurement[] = [];

let requestCount = 0;
let transferredBytes = 0;

/** Counts what actually goes over the wire, rather than what is returned. */
const countingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input as RequestInfo, init as RequestInit);
  requestCount += 1;
  transferredBytes += (await response.clone().arrayBuffer()).byteLength;
  return response;
};

function psql(args: string[], input?: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", ...args],
    { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }
  );
}

function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A plan for a query run as the signed-in user, policies and all. */
function authenticatedPlan(sql: string) {
  const claims = JSON.stringify({ sub: authUserId, role: "authenticated" });
  return psql(
    ["-X", "-q", "--single-transaction", "-f", "-"],
    `set local role authenticated;
     set local request.jwt.claims = ${quote(claims)};
     ${sql}`
  );
}

/** The API pools connections; a bulk re-seed can drop one mid-flight. */
async function waitForApi() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await user.from("events").select("id").eq("team_id", TEAM).limit(1);
    if (!error) return;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("The API did not come back after re-seeding");
}

function seed(events: number) {
  psql(
    ["-X", "-q", "-v", `caller=${callerProfileId}`, "-v", `events=${events}`, "-f", "-"],
    readFileSync("scripts/scale-check/seed.sql", "utf8")
  );
}

/**
 * Removes the fixture, data first.
 *
 * Order matters and is not obvious: every seeded event carries the caller's
 * profile in `created_by`, and `events_created_by_fkey` has no delete action.
 * Deleting the account cascades to its profile, which those events block — so
 * an account-first teardown fails, and fails quietly if nobody checks.
 */
async function removeFixture() {
  psql([
    "-X",
    "-q",
    "-c",
    `delete from organizations where slug = ${quote(ORG_SLUG)};
     delete from profiles where email like 'scale-player-%@fixture.local';`,
  ]);

  const existing = psql([
    "-X",
    "-t",
    "-A",
    "-c",
    `select id from auth.users where email = ${quote(EMAIL)}`,
  ]).trim();

  if (existing) {
    const { error } = await adminClient.auth.admin.deleteUser(existing);
    if (error) throw new Error(`Could not remove the fixture account: ${error.message}`);
  }

  const left = psql([
    "-X",
    "-t",
    "-A",
    "-c",
    `select count(*) from auth.users where email = ${quote(EMAIL)}`,
  ]).trim();
  // A verification command that leaves identities behind has not verified much.
  if (left !== "0") throw new Error(`Fixture account still present after cleanup: ${left}`);
}

async function measure<T>(label: string, run: () => Promise<T>): Promise<T> {
  const requestsBefore = requestCount;
  const bytesBefore = transferredBytes;
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;

  const rows = Array.isArray(result)
    ? result.length
    : ((result as { items?: unknown[] }).items?.length ?? (result as { rows?: number }).rows ?? 1);

  measurements.push({
    label,
    ms: Math.round(ms),
    rows: typeof rows === "number" ? rows : 1,
    requests: requestCount - requestsBefore,
    kib: Number(((transferredBytes - bytesBefore) / 1024).toFixed(1)),
  });
  return result;
}

beforeAll(async () => {
  // An interrupted run leaves a fixture behind; clear it the same careful way.
  await removeFixture();

  const { data: created, error } = await adminClient.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: "Scale", last_name: "Check" },
  });
  if (error) throw error;
  authUserId = created.user.id;

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  if (profileError) throw profileError;
  callerProfileId = profile.id as string;

  seed(FULL_SIZE);

  user = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: countingFetch } }
  );
  const { error: signInError } = await user.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
}, 600_000);

afterAll(async () => {
  await user?.auth.signOut();
  await removeFixture();

  const width = Math.max(...measurements.map((m) => m.label.length));
  console.log("\n  Authenticated reads — 100,000 events, 151 members, 4,500 responses\n");
  console.log(
    `  ${"".padEnd(width)}  ${"time".padStart(8)}  ${"rows".padStart(6)}  ${"reqs".padStart(5)}  ${"transferred".padStart(12)}`
  );
  for (const m of measurements) {
    console.log(
      `  ${m.label.padEnd(width)}  ${(m.ms + " ms").padStart(8)}  ${String(m.rows).padStart(6)}  ${String(m.requests).padStart(5)}  ${(m.kib + " KiB").padStart(12)}`
    );
  }
  console.log("");
}, 300_000);

describe("the fixture", () => {
  it("is as big as the check needs it to be", () => {
    const counts = psql([
      "-X",
      "-t",
      "-A",
      "-c",
      `select
         (select count(*) from events where team_id = '${TEAM}'),
         (select count(*) from events where team_id = '${TEAM}' and start_time >= now()),
         (select count(*) from team_members where team_id = '${TEAM}'),
         (select count(*) from availability a join events e on e.id = a.event_id where e.team_id = '${TEAM}')`,
    ]);
    const [events, upcoming, roster, responses] = counts.trim().split("|").map(Number);

    expect(events).toBe(FULL_SIZE);
    expect(upcoming).toBeGreaterThanOrEqual(320);
    expect(roster).toBe(151); // 150 players plus the caller
    expect(responses).toBeGreaterThan(1_000);
  });

  it("is being measured against the real row cap", async () => {
    // Spec §13: a cap lower than production's would make the batching proof
    // meaningless, and a higher one would let a single request return what
    // production truncates. Either is an incompatible configuration.
    const { data, error } = await user.from("events").select("id").eq("team_id", TEAM).limit(5_000);

    expect(error).toBeNull();
    expect(data).toHaveLength(1_000);
  });
});

describe("what a page costs when the history is enormous", () => {
  it("reads one list page, in one request, with no history", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    const page = await measure("Schedule list — one page of 50", () =>
      fetchEventPage(user, {
        query: { teamId: TEAM, fromInclusive: from.toISOString(), toExclusive: to.toISOString() },
        pageSize: 50,
        cursor: null,
        projection: "list",
      })
    );

    expect(page.items).toHaveLength(50);
    expect(page.hasNext).toBe(true);
    // 99,680 past events exist on this team. None of them travelled.
    for (const event of page.items) {
      expect(Date.parse(event.start_time)).toBeGreaterThanOrEqual(from.getTime());
    }
    expect(measurements.at(-1)!.requests).toBe(1);
  });

  it("reads a calendar month, prefetches its neighbours, and keeps the cache bounded", async () => {
    const monthKey = monthKeyOf(new Date(), ZONE);
    const loader = createMonthLoader<CalendarEventRow>({
      read: (key) => {
        const range = monthRange(key, ZONE);
        return fetchEventRange(user, {
          query: {
            teamId: TEAM,
            fromInclusive: range.fromInclusive,
            toExclusive: range.toExclusive,
          },
          projection: "calendar",
        });
      },
    });

    const month = await measure("Calendar — the selected month", () => loader.load(monthKey));
    // Proportional to the month, not to the history behind it: 320 upcoming
    // events spread over 160 days is about 60 in the current month.
    expect(month.length).toBeLessThan(200);

    await measure("Calendar — a neighbour, prefetched", async () => {
      await loader.prefetch(addMonths(monthKey, 1));
      return loader.peek(addMonths(monthKey, 1)) ?? [];
    });

    // Walk further than the cache is allowed to hold.
    for (let i = 2; i <= 8; i++) await loader.load(addMonths(monthKey, i));
    expect(loader.size()).toBeLessThanOrEqual(6);

    // Revisiting a cached month costs nothing at all.
    const before = requestCount;
    await loader.load(addMonths(monthKey, 8));
    expect(requestCount).toBe(before);
  });

  it("returns every response for a displayed page, past the row cap", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);
    const query = {
      teamId: TEAM,
      fromInclusive: from.toISOString(),
      toExclusive: to.toISOString(),
      includeCancelled: true,
    };

    // What the matrix actually waits for before it can draw anything.
    const ready = await measure("Availability — view ready (page + responses + roster)", async () => {
      const page = await fetchEventPage(user, {
        query,
        pageSize: 10,
        cursor: null,
        projection: "calendar",
      });
      const [responses, roster] = await Promise.all([
        fetchResponsesForEvents(
          user,
          page.items.map((e) => e.id)
        ),
        fetchTeamRoster(user, TEAM),
      ]);
      return { items: page.items, responses, roster, rows: responses.length };
    });

    expect(ready.items).toHaveLength(10);
    // Ten events × 150 members, which one request cannot return.
    expect(ready.responses.length).toBe(1_500);
    const keys = new Set(ready.responses.map((r) => `${r.event_id}:${r.profile_id}`));
    expect(keys.size).toBe(ready.responses.length);
    expect(ready.roster.length).toBe(151);

    // The same read for one event, so the per-row cost of the response policy
    // is measured at two sizes rather than extrapolated from one.
    const single = await measure("  …responses for a single event", () =>
      fetchResponsesForEvents(user, [ready.items[0].id])
    );
    // The 150 seeded players; the caller has answered nothing yet.
    expect(single.length).toBe(150);
  });

  it("costs the same on page 21 as on page 1", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);
    const query = { teamId: TEAM, fromInclusive: from.toISOString(), toExclusive: to.toISOString() };

    const first = await measure("Availability — page 1", () =>
      fetchEventPage(user, { query, pageSize: 10, cursor: null, projection: "calendar" })
    );
    let cursor = first.nextCursor;
    for (let i = 0; i < 19; i++) {
      const page = await fetchEventPage(user, { query, pageSize: 10, cursor, projection: "calendar" });
      cursor = page.nextCursor;
      expect(cursor).not.toBeNull();
    }
    // Kept for the plan below, so what is explained is what was actually sent.
    deepCursor = cursor;

    const deep = await measure("Availability — page 21, by cursor", () =>
      fetchEventPage(user, { query, pageSize: 10, cursor, projection: "calendar" })
    );

    expect(deep.items).toHaveLength(10);
    expect(measurements.at(-1)!.requests).toBe(1);
    expect(measurements.at(-1)!.rows).toBe(first.items.length);
  });

  it("sets every unanswered event in the window in one request", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    const result = await measure("Bulk — every unanswered event in the window", async () => {
      const { data, error } = await user.rpc("set_unanswered_availability", {
        p_team_id: TEAM,
        p_profile_id: callerProfileId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_status: "available",
      });
      if (error) throw new Error(error.message);
      return { inserted: data };
    });

    expect(result.inserted).toBeGreaterThan(300);
    expect(measurements.at(-1)!.requests).toBe(1);

    // Run again: everything is answered, so it writes nothing rather than
    // overwriting what it just wrote.
    const { data: second } = await user.rpc("set_unanswered_availability", {
      p_team_id: TEAM,
      p_profile_id: callerProfileId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_status: "unavailable",
    });
    expect(second).toBe(0);
  });
});

describe("the authenticated plan for the query that was actually sent", () => {
  it("starts the scan at the cursor instead of filtering up to it", () => {
    expect(deepCursor).not.toBeNull();
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    // The continuation as the repository composes it: the window's bounds, the
    // cursor's redundant lower bound, and the keyset itself.
    const predicate = (withLowerBound: boolean) => `
      where team_id = ${quote(TEAM)}
        and start_time >= ${quote(from.toISOString())}
        and start_time < ${quote(to.toISOString())}
        ${withLowerBound ? `and start_time >= ${quote(deepCursor!.startTime)}` : ""}
        and (
          start_time > ${quote(deepCursor!.startTime)}
          or (start_time = ${quote(deepCursor!.startTime)} and id > ${quote(deepCursor!.id)})
        )
      order by start_time, id
      limit 11`;

    const select = `select id, title, event_type, start_time, end_time, is_cancelled from events`;
    const asSent = authenticatedPlan(
      `explain (analyze, buffers, costs off) ${select} ${predicate(true)};`
    );
    const withoutLowerBound = authenticatedPlan(
      `explain (analyze, buffers, costs off) ${select} ${predicate(false)};`
    );

    // Printed before anything is asserted: a claim that fails should still
    // show the evidence that refutes it.
    console.log(`\n  Continuation plan, as sent:\n${indent(asSent)}`);
    console.log(`\n  The same page without the cursor lower bound:\n${indent(withoutLowerBound)}`);

    expect(asSent).toContain("events_team_start_id_idx");
    expect(asSent).toContain("Index Cond");
    // The index supplies the order, so nothing is gathered up and sorted.
    expect(asSent).not.toContain("Sort Method");

    // Every node that discarded rows, not just the first one printed.
    const removed = (plan: string) =>
      [...plan.matchAll(/Rows Removed by Filter: (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    // The topmost total, which is the whole statement's.
    const buffers = (plan: string) => Number(/Buffers: shared hit=(\d+)/.exec(plan)?.[1] ?? 0);

    // The cursor's bound is *in* the index condition, alongside the window's.
    // That is the whole point of sending it, and losing it is invisible in the
    // results — so this is what catches its removal.
    const indexCond = /Index Cond: \(([^\n]*)\)/.exec(asSent)?.[1] ?? "";
    expect((indexCond.match(/start_time >=/g) ?? []).length).toBe(2);
    expect(removed(asSent)).toBeLessThan(20);

    // Without it, Postgres cannot use the OR as an index start condition. It
    // does not scan and discard, as I assumed before measuring it: it unions
    // two bitmap scans and sorts the result, reading several times the pages to
    // return the same ten rows.
    expect(withoutLowerBound).toContain("Sort Method");
    expect(buffers(withoutLowerBound)).toBeGreaterThan(buffers(asSent));
  });

  it("reads responses by their unique key", () => {
    const plan = authenticatedPlan(
      `explain (analyze, buffers, costs off)
       select event_id, profile_id, status
       from availability
       where event_id in (
         select id from events
         where team_id = ${quote(TEAM)} and start_time >= now()
         order by start_time, id limit 10
       )
       order by event_id, profile_id
       limit 501;`
    );

    expect(plan).toMatch(/Index|Bitmap/);
    console.log(`\n  Response batch plan:\n${indent(plan)}`);
  });
});

describe("as the history grows", () => {
  // Spec §13: the same visible page, measured at each size. The point is that
  // the page does not get more expensive because the team got older.
  const sizes = [10_000, 1_000];

  it.each(sizes)("reads the same page at %i events", async (size) => {
    seed(size);
    await waitForApi();
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    const page = await measure(`Schedule list — one page of 50, at ${size.toLocaleString()} events`, () =>
      fetchEventPage(user, {
        query: { teamId: TEAM, fromInclusive: from.toISOString(), toExclusive: to.toISOString() },
        pageSize: 50,
        cursor: null,
        projection: "list",
      })
    );

    expect(page.items).toHaveLength(50);
    const taken = measurements.at(-1)!;
    expect(taken.requests).toBe(1);
    // The payload is the page, whatever is behind it.
    expect(taken.kib).toBeLessThan(60);
  }, 300_000);
});

function indent(text: string) {
  return text
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
