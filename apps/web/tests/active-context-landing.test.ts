/**
 * D5 (docs/specs/device-local-active-context.md): creating a team, or accepting
 * an invitation, lands this device on the result, as the person it's for,
 * whatever it had saved. Nothing invalid is saved: no team, or a club team
 * the creator wasn't enrolled on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ME = "00000000-0000-4000-8000-000000000001";
const CHILD = "00000000-0000-4000-8000-000000000002";
const TEAM = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => {
  const state = {
    rpc: { data: null as unknown, error: null as unknown },
    accept: null as unknown,
    orgMembers: [] as { profile_id: string; role: string }[],
    memberInsertError: null as unknown,
  };
  const saved: unknown[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "update", "order", "limit"]) chain[m] = () => chain;
    const data = () =>
      table === "organization_members"
        ? state.orgMembers
        : table === "profiles"
          ? { id: "00000000-0000-4000-8000-000000000001" }
          : table === "organizations"
            ? { id: "20000000-0000-4000-8000-000000000001", plan: "club_small", closed_at: null, subscription_status: "active" }
            : null;
    chain.insert = () => Promise.resolve({ error: table === "team_members" ? state.memberInsertError : null });
    chain.single = () => Promise.resolve({ data: data(), error: null });
    chain.maybeSingle = chain.single;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: data(), error: null }).then(res, rej);
    return chain;
  };
  return {
    state,
    saved,
    admin: { rpc: async () => state.rpc, from },
    user: { id: "00000000-0000-4000-8000-000000000001" },
  };
});

vi.mock("@/lib/api-auth", () => ({ resolveRequestUser: async () => mocks.user, adminClient: () => mocks.admin }));
vi.mock("@/lib/active-context-save", () => ({
  saveContextCookie: async (context: unknown) => void mocks.saved.push(context),
}));
vi.mock("@/lib/invitations/accept", () => ({ acceptInvitation: async () => mocks.state.accept }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as createTeam } from "@/app/api/teams/route";
import { POST as acceptApi } from "@/app/api/invite/[id]/accept/route";
import { acceptInvitationAsSelf, acceptInvitationAsGuardian, acceptManagerInvitation } from "@/app/actions/invite";

const json = (body: unknown) => new Request("https://lista.team/api", { method: "POST", body: JSON.stringify(body) });
const accepted = (teamId: string | null, managedProfileId: string | null) => ({
  ok: true,
  teamId,
  teamMemberId: "tm-1",
  managedProfileId,
});

beforeEach(() => {
  mocks.saved.length = 0;
  mocks.state.rpc = { data: TEAM, error: null };
  mocks.state.accept = null;
  mocks.state.orgMembers = [];
  mocks.state.memberInsertError = null;
});

describe("creating a team", () => {
  it("lands this device on the new team, as the account's own profile", async () => {
    const res = await createTeam(json({ teamName: "U12 Boys" }));

    expect(res.status).toBe(200);
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: ME, teamId: TEAM }]);
  });

  it("a failed creation saves nothing", async () => {
    mocks.state.rpc = { data: null, error: { message: "nope" } };

    await createTeam(json({ teamName: "U12 Boys" }));
    expect(mocks.saved).toEqual([]);
  });
});

describe("accepting an invitation, by the API (web or mobile)", () => {
  it("as yourself: lands on the team as your own profile, and says which", async () => {
    mocks.state.accept = accepted(TEAM, null);

    const res = await acceptApi(json({ type: "self" }), { params: Promise.resolve({ id: "inv-1" }) });

    expect(await res.json()).toEqual({ success: true, teamId: TEAM, managedProfileId: null });
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: ME, teamId: TEAM }]);
  });

  it("as a guardian: lands as the child", async () => {
    mocks.state.accept = accepted(TEAM, CHILD);

    const res = await acceptApi(json({ type: "guardian", relationship: "Mom" }), { params: Promise.resolve({ id: "inv-1" }) });

    expect(await res.json()).toEqual({ success: true, teamId: TEAM, managedProfileId: CHILD });
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: CHILD, teamId: TEAM }]);
  });

  it("a director invitation with no team saves nothing", async () => {
    mocks.state.accept = accepted(null, null);

    const res = await acceptApi(json({ type: "self" }), { params: Promise.resolve({ id: "inv-1" }) });

    expect((await res.json()).success).toBe(true);
    expect(mocks.saved).toEqual([]);
  });
});

describe("accepting an invitation, on the web", () => {
  it("as yourself", async () => {
    mocks.state.accept = accepted(TEAM, null);

    await acceptInvitationAsSelf("inv-1");
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: ME, teamId: TEAM }]);
  });

  it("as a guardian, a new child or one you already manage", async () => {
    mocks.state.accept = accepted(TEAM, CHILD);

    await acceptInvitationAsGuardian("inv-1", { relationship: "Dad" });
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: CHILD, teamId: TEAM }]);
  });

  it("to manage an existing player", async () => {
    mocks.state.accept = accepted(TEAM, CHILD);

    await acceptManagerInvitation("inv-1");
    expect(mocks.saved).toEqual([{ accountId: ME, profileId: CHILD, teamId: TEAM }]);
  });

  it("a director invitation with no team saves nothing", async () => {
    mocks.state.accept = accepted(null, null);

    await acceptInvitationAsSelf("inv-1");
    expect(mocks.saved).toEqual([]);
  });
});
