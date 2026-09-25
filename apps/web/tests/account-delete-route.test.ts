/**
 * Unit tests for GET/DELETE /api/account/delete — sole-guardian refusal (BUG-002, D7)
 * and club ownership (BUG-013).
 *
 * Every player profile must keep a login path. The database refuses to delete a
 * guardian account when a player they manage has no login of their own and no
 * other guardian with one. The route checks first so the user gets a clear
 * explanation rather than a generic deletion failure.
 *
 * Supabase auth and the admin client are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestUser: vi.fn(),
  ownedTeams: {
    data: [] as Array<{ name: string; organizations?: { closed_at: string | null } | null }>,
    error: null as unknown,
  },
  // Each database function's result, by name.
  dependents: { data: [] as unknown, error: null as unknown },
  ownedClubs: { data: [] as unknown, error: null as unknown },
  rpc: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.resolveRequestUser,
  adminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve(mocks.ownedTeams) }),
    }),
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
  }),
}));

import { GET, DELETE } from "@/app/api/account/delete/route";

const USER = { id: "parent-1", email: "parent@example.com" };

function request(method: "GET" | "DELETE") {
  return new Request("http://localhost:3000/api/account/delete", { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestUser.mockResolvedValue(USER);
  mocks.ownedTeams = { data: [], error: null };
  mocks.dependents = { data: [], error: null };
  mocks.ownedClubs = { data: [], error: null };
  mocks.rpc.mockImplementation(async (fn: string) =>
    fn === "owned_open_clubs" ? mocks.ownedClubs : mocks.dependents
  );
  mocks.deleteUser.mockResolvedValue({ error: null });
});

describe("account deletion — sole guardian (BUG-002)", () => {
  it("GET reports 409 sole_guardian with the players who would be left without a login", async () => {
    mocks.dependents = {
      data: [{ profile_id: "child-1", first_name: "Ava", last_name: "Smith" }],
      error: null,
    };

    const res = await GET(request("GET"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "sole_guardian", players: ["Ava Smith"] });
    expect(mocks.rpc).toHaveBeenCalledWith("guardian_dependents", { p_manager_id: USER.id });
  });

  it("DELETE refuses with 409 and never deletes the auth user", async () => {
    mocks.dependents = {
      data: [{ profile_id: "child-1", first_name: "Ava", last_name: "Smith" }],
      error: null,
    };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "sole_guardian", players: ["Ava Smith"] });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("DELETE fails closed with 500 when the dependents check errors", async () => {
    mocks.dependents = { data: null, error: { message: "boom" } };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(500);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("DELETE proceeds when no player depends on this account", async () => {
    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("still reports owned teams first", async () => {
    mocks.ownedTeams = { data: [{ name: "U10 Blue" }], error: null };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owns_teams", teams: ["U10 Blue"] });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});

describe("account deletion — club ownership (BUG-013)", () => {
  it("refuses while they own an open club, naming it, before anything else", async () => {
    mocks.ownedClubs = { data: [{ id: "org-1", name: "Westside FC" }], error: null };
    mocks.ownedTeams = { data: [{ name: "U10 Blue" }], error: null };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owns_club", clubs: ["Westside FC"] });
    expect(mocks.rpc).toHaveBeenCalledWith("owned_open_clubs", { p_profile_id: USER.id });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("GET reports the same", async () => {
    mocks.ownedClubs = { data: [{ id: "org-1", name: "Westside FC" }], error: null };

    const res = await GET(request("GET"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owns_club", clubs: ["Westside FC"] });
  });

  it("fails closed when the club check errors", async () => {
    mocks.ownedClubs = { data: null, error: { message: "boom" } };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(500);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("teams in a closed club no longer block deletion", async () => {
    mocks.ownedTeams = {
      data: [{ name: "U10 Blue", organizations: { closed_at: "2026-09-24T00:00:00Z" } }],
      error: null,
    };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("teams in an open club still do", async () => {
    mocks.ownedTeams = { data: [{ name: "U10 Blue", organizations: { closed_at: null } }], error: null };

    const res = await DELETE(request("DELETE"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owns_teams", teams: ["U10 Blue"] });
  });
});
