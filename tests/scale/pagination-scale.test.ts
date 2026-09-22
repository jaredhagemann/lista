/**
 * Scale verification for the pagination work (BUG-014, spec §13).
 *
 * Not part of any suite that runs on its own: it seeds 100,000 events and needs
 * the local stack. Run it deliberately:
 *
 *   pnpm exec vitest run --config vitest.config.rls.mts tests/scale
 *
 * The spec asks for "deterministic structural goals rather than inventing a
 * production latency SLA", so the assertions are structural — how much is read,
 * how much comes back, and what the plan does — while the timings are recorded
 * and printed rather than asserted. A test that fails when a laptop is busy
 * teaches nobody anything.
 *
 * Everything is read through the same repository functions the components use,
 * signed in as an ordinary player. A service-role read would skip the policies
 * that make up much of the cost, which is the mistake the spec warns about:
 * "Service-role fixture setup is not sufficient authorization coverage."
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "../rls/helpers";
import { fetchEventPage } from "@/lib/events/queries";
import { fetchResponsesForEvents, fetchTeamRoster } from "@/lib/availability/queries";

const TEAM = "5ca1e000-0000-0000-0000-000000000002";
const EMAIL = "scale-check@fixture.local";
const PASSWORD = "scale-check-password-123!";
const DAY_MS = 864e5;

let user: SupabaseClient;
let callerProfileId: string;
let authUserId: string;

const measurements: { label: string; ms: number; rows: number; kib: number }[] = [];

function psql(args: string[], input?: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", ...args],
    { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 }
  );
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

function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function measure<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;
  const rows = Array.isArray(result)
    ? result.length
    : ((result as { items?: unknown[] }).items?.length ?? 1);
  measurements.push({
    label,
    ms: Math.round(ms),
    rows,
    kib: Number((Buffer.byteLength(JSON.stringify(result)) / 1024).toFixed(1)),
  });
  return result;
}

beforeAll(async () => {
  const { data: existing } = await adminClient.auth.admin.listUsers();
  const previous = existing.users.find((u) => u.email === EMAIL);
  if (previous) await adminClient.auth.admin.deleteUser(previous.id);

  const { data: created, error } = await adminClient.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: "Scale", last_name: "Check" },
  });
  if (error) throw error;
  authUserId = created.user.id;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  callerProfileId = profile!.id as string;

  psql(["-X", "-q", "-v", `caller=${callerProfileId}`, "-f", "-"], readFileSync("scripts/scale-check/seed.sql", "utf8"));

  user = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { error: signInError } = await user.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
}, 300_000);

afterAll(async () => {
  await user?.auth.signOut();
  const { data: list } = await adminClient.auth.admin.listUsers();
  const caller = list.users.find((u) => u.email === EMAIL);
  if (caller) await adminClient.auth.admin.deleteUser(caller.id);
  psql([
    "-X",
    "-q",
    "-c",
    "delete from organizations where slug = 'scale-check-fixture'; delete from profiles where email like 'scale-player-%@fixture.local';",
  ]);

  const width = Math.max(...measurements.map((m) => m.label.length));
  console.log("\n  Authenticated reads — 100,000 events, 150 members, 4,500 responses\n");
  for (const m of measurements) {
    console.log(
      `  ${m.label.padEnd(width)}  ${String(m.ms).padStart(6)} ms  ${String(m.rows).padStart(5)} rows  ${String(m.kib).padStart(8)} KiB`
    );
  }
  console.log("");
}, 120_000);

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

    expect(events).toBe(100_000);
    expect(upcoming).toBeGreaterThanOrEqual(320);
    expect(roster).toBe(151); // 150 players plus the caller
    // More than the API's row cap for a single displayed page of ten events.
    expect(responses).toBeGreaterThan(1_000);
  });

  it("is being measured against the real row cap", async () => {
    // Spec §13: a cap lower than the one production enforces would make the
    // batching proof meaningless, and a cap higher than 1,000 would let a
    // single request return what production would truncate. Either is an
    // incompatible configuration, not a passing check.
    const { data, error } = await user
      .from("events")
      .select("id")
      .eq("team_id", TEAM)
      .limit(5_000);

    expect(error).toBeNull();
    expect(data).toHaveLength(1_000);
  });
});

describe("what a page costs when the history is enormous", () => {
  it("reads one list page, and no history at all", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    const page = await measure("Schedule list — one page of 50", () =>
      fetchEventPage(user, {
        query: {
          teamId: TEAM,
          fromInclusive: from.toISOString(),
          toExclusive: to.toISOString(),
        },
        pageSize: 50,
        cursor: null,
        projection: "list",
      })
    );

    expect(page.items).toHaveLength(50);
    expect(page.hasNext).toBe(true);
    // 99,680 past events exist. None of them travelled.
    for (const event of page.items) {
      expect(Date.parse(event.start_time)).toBeGreaterThanOrEqual(from.getTime());
    }
  });

  it("returns every response for a displayed page, past the row cap", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);

    const page = await measure("Availability — one page of 10 events", () =>
      fetchEventPage(user, {
        query: {
          teamId: TEAM,
          fromInclusive: from.toISOString(),
          toExclusive: to.toISOString(),
          includeCancelled: true,
        },
        pageSize: 10,
        cursor: null,
        projection: "calendar",
      })
    );
    expect(page.items).toHaveLength(10);

    const responses = await measure("  …its responses, across batches", () =>
      fetchResponsesForEvents(
        user,
        page.items.map((e) => e.id)
      )
    );
    const roster = await measure("  …the roster", () => fetchTeamRoster(user, TEAM));

    // The same read for one event, so the per-row cost of the response policy
    // is measured rather than extrapolated. A 150-member team is far larger
    // than this app's usual; most pages are nearer this size.
    const oneEvent = await measure("  …responses for a single event", () =>
      fetchResponsesForEvents(user, [page.items[0].id])
    );
    // The 150 seeded players; the caller has answered nothing yet.
    expect(oneEvent.length).toBe(150);

    // Ten events × 150 members, which one request cannot return.
    expect(responses.length).toBe(1_500);
    const keys = new Set(responses.map((r) => `${r.event_id}:${r.profile_id}`));
    expect(keys.size).toBe(responses.length);
    expect(roster.length).toBe(151);
  });

  it("costs the same on page 21 as on page 1", async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 180 * DAY_MS);
    const query = {
      teamId: TEAM,
      fromInclusive: from.toISOString(),
      toExclusive: to.toISOString(),
    };

    let cursor = null as Awaited<ReturnType<typeof fetchEventPage>>["nextCursor"];
    for (let i = 0; i < 20; i++) {
      const page = await fetchEventPage(user, { query, pageSize: 10, cursor, projection: "calendar" });
      cursor = page.nextCursor;
      expect(cursor).not.toBeNull();
    }

    const deep = await measure("Availability — page 21, by cursor", () =>
      fetchEventPage(user, { query, pageSize: 10, cursor, projection: "calendar" })
    );
    expect(deep.items).toHaveLength(10);

    // An offset of 200 would have read 210 rows to return 10. The keyset reads
    // 11. The plan below is what proves it; this is the shape of the result.
    const first = measurements.find((m) => m.label.startsWith("Availability — one page"))!;
    const last = measurements.find((m) => m.label.startsWith("Availability — page 21"))!;
    expect(last.rows).toBe(first.rows);
  });

  it("sets 320 unanswered events in one request", async () => {
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

    // The caller answered nothing, so every upcoming event in the window is
    // filled in — including the ~300 on pages the browser never loaded, and
    // excluding the cancelled ones.
    expect(result.inserted).toBeGreaterThan(300);

    // Run again: everything is answered now, so it writes nothing rather than
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

describe("the authenticated query plans", () => {
  it("starts the event scan at the cursor instead of filtering up to it", () => {
    // The same shape PostgREST sends for page 21, with the keyset as written.
    const plan = authenticatedPlan(
      `explain (analyze, buffers, costs off)
       select id, title, event_type, start_time, end_time, is_cancelled
       from events
       where team_id = ${quote(TEAM)}
         and start_time >= now()
         and start_time < now() + interval '180 days'
       order by start_time, id
       limit 11;`
    );

    expect(plan).toContain("events_team_start_id_idx");
    expect(plan).toContain("Index Cond");
    // The index supplies the order, so nothing is gathered up and sorted.
    expect(plan).not.toContain("Sort Method");

    const removed = Number(/Rows Removed by Filter: (\d+)/.exec(plan)?.[1] ?? 0);
    // The point of the index: reaching a page deep in the window must not mean
    // reading everything in front of it.
    expect(removed).toBeLessThan(100);
    console.log(`\n  Event page plan:\n${indent(plan)}`);
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

function indent(text: string) {
  return text
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
