/**
 * Unit tests for the removeProfileManager server action (app/actions/managers.ts).
 *
 * BUG-002, decision D1: a guardian may be removed by the player or by an existing
 * guardian. A staff role alone does not grant removal. A coach at one club must
 * not be able to sever a parent's link that the child's other clubs rely on.
 *
 * The database separately refuses to remove the last guardian of a player with
 * no login of their own; the action must turn that refusal into a clear message.
 *
 * Supabase is mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Filter = { column: string; value: unknown };
type Query = { table: string; op: "select" | "delete"; filters: Filter[] };

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  // Resolves every terminal query by table/op/filters, so the tests describe
  // the data rather than the exact call sequence.
  resolve: vi.fn(),
  deletes: [] as Array<{ table: string; filters: Array<{ column: string; value: unknown }> }>,
}));

function builder(table: string) {
  const query: Query = { table, op: "select", filters: [] };
  const run = () => {
    if (query.op === "delete") mocks.deletes.push({ table, filters: query.filters });
    return Promise.resolve(mocks.resolve(query));
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    delete: () => {
      query.op = "delete";
      return chain;
    },
    single: run,
    maybeSingle: run,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  for (const op of ["eq", "neq", "in"]) {
    chain[op] = (column: string, value: unknown) => {
      query.filters.push({ column, value });
      return chain;
    };
  }
  return chain;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: builder })),
}));

import { removeProfileManager } from "@/app/actions/managers";
import { LAST_GUARDIAN_MESSAGE } from "@/lib/guardians";

// ── Fixture ───────────────────────────────────────────────────────────────────
// Child "child-1" has no login. Guardians: "parent-1" (row "row-p1") and
// "parent-2". "coach-1" coaches a team the child is on. "teen-1" is a player
// with their own login, guarded by "parent-1" (row "row-teen").

const ROWS: Record<string, { manager_id: string; managed_id: string }> = {
  "row-p1": { manager_id: "parent-1", managed_id: "child-1" },
  "row-teen": { manager_id: "parent-1", managed_id: "teen-1" },
  "row-teen-self": { manager_id: "teen-1", managed_id: "teen-1" },
};
const GUARDIAN_LINKS = [
  { manager_id: "parent-1", managed_id: "child-1" },
  { manager_id: "parent-2", managed_id: "child-1" },
  { manager_id: "parent-1", managed_id: "teen-1" },
];
const AUTH_USER_IDS: Record<string, string | null> = { "child-1": null, "teen-1": "teen-1" };

function value(filters: Filter[], column: string) {
  return filters.find((f) => f.column === column)?.value;
}

function defaultResolve(query: Query) {
  const { table, op, filters } = query;
  if (op === "delete") return { error: null };

  if (table === "profile_managers") {
    const rowId = value(filters, "id");
    if (rowId !== undefined) return { data: ROWS[rowId as string] ?? null, error: null };
    const link = GUARDIAN_LINKS.find(
      (l) => l.manager_id === value(filters, "manager_id") && l.managed_id === value(filters, "managed_id"),
    );
    return { data: link ? { id: "link" } : null, error: null };
  }

  if (table === "profiles") {
    const id = value(filters, "id") as string;
    return { data: id in AUTH_USER_IDS ? { auth_user_id: AUTH_USER_IDS[id] } : null, error: null };
  }

  // team_members: coach-1 administers a team child-1 is on. The old rule
  // treated that as permission to remove a guardian.
  if (table === "team_members") {
    if (value(filters, "profile_id") === "coach-1") return { data: [{ id: "tm-c", team_id: "team-1" }], error: null };
    if (value(filters, "profile_id") === "child-1") return { data: [{ team_id: "team-1" }], error: null };
    return { data: [], error: null };
  }

  return { data: null, error: null };
}

function signedInAs(id: string | null) {
  mocks.getUser.mockResolvedValue({ data: { user: id ? { id } : null } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deletes.length = 0;
  mocks.resolve.mockImplementation(defaultResolve);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("removeProfileManager — who may remove a guardian (BUG-002, D1)", () => {
  it("refuses a coach whose only connection is a shared team", async () => {
    signedInAs("coach-1");

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ error: "Not authorized" });
    expect(mocks.deletes).toHaveLength(0);
  });

  it("lets another guardian of the same child remove a guardian", async () => {
    signedInAs("parent-2");

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ success: true });
    expect(mocks.deletes).toHaveLength(1);
  });

  it("lets a player with their own login remove one of their guardians", async () => {
    signedInAs("teen-1");

    const result = await removeProfileManager("row-teen");

    expect(result).toEqual({ success: true });
    expect(mocks.deletes).toHaveLength(1);
  });

  it("lets a guardian remove their own link", async () => {
    signedInAs("parent-1");

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ success: true });
  });

  it("refuses a guardian removing the player's own Self link", async () => {
    signedInAs("parent-1");

    const result = await removeProfileManager("row-teen-self");

    expect(result).toEqual({ error: "Not authorized" });
    expect(mocks.deletes).toHaveLength(0);
  });

  it("refuses an unrelated user", async () => {
    signedInAs("stranger-1");

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ error: "Not authorized" });
    expect(mocks.deletes).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    signedInAs(null);

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("explains the refusal when the database protects the last guardian", async () => {
    signedInAs("parent-1");
    mocks.resolve.mockImplementation((query: Query) =>
      query.op === "delete"
        ? { error: { message: "LAST_GUARDIAN: player child-1 must keep at least one guardian with a login" } }
        : defaultResolve(query),
    );

    const result = await removeProfileManager("row-p1");

    expect(result).toEqual({ error: LAST_GUARDIAN_MESSAGE });
  });
});
