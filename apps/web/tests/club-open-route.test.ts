/**
 * GET /dashboard/club/open?org=<id> opens that club's settings (BUG-028 review).
 *
 * Club settings pick the club from the viewer's active team. A deletion refusal
 * names the club the owner must hand over, but a plain link to
 * /dashboard/club/settings opened whichever club the active team belonged to,
 * or bounced to the dashboard when that team wasn't in a club. This route
 * checks the viewer runs the club, switches to one of its teams they're on,
 * then opens its settings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown) => result().then(res);
    return chain;
  };
  return {
    tables,
    user: { id: "u-1" } as { id: string } | null,
    setActiveTeam: vi.fn(),
    client: {
      from,
      auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/app/actions/team", () => ({ setActiveTeam: mocks.setActiveTeam }));

import { GET } from "@/app/dashboard/club/open/route";

const ORG = "3f1c2a9e-7b4d-4c1e-9a2b-5d6e7f8a9b0c";

async function open(query: string) {
  const res = await GET(new Request(`https://lista.team/dashboard/club/open${query}`));
  return { status: res.status, location: res.headers.get("location") };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.user = { id: "u-1" };
  mocks.setActiveTeam.mockResolvedValue({ success: true });
});

describe("opening a named club's settings", () => {
  it("switches a director of the club to one of its teams and opens club settings", async () => {
    mocks.tables.organization_members = { role: "owner" };
    mocks.tables.team_members = [{ team_id: "t-club" }];

    const res = await open(`?org=${ORG}`);

    expect(mocks.setActiveTeam).toHaveBeenCalledWith("t-club");
    expect(res.location).toBe("https://lista.team/dashboard/club/settings");
  });

  it("sends someone who doesn't run the club to the dashboard without switching", async () => {
    mocks.tables.organization_members = null;
    mocks.tables.team_members = [{ team_id: "t-club" }];

    const res = await open(`?org=${ORG}`);

    expect(mocks.setActiveTeam).not.toHaveBeenCalled();
    expect(res.location).toBe("https://lista.team/dashboard");
  });

  it("sends a missing or malformed club id to the dashboard", async () => {
    mocks.tables.organization_members = { role: "owner" };

    expect((await open("")).location).toBe("https://lista.team/dashboard");
    expect((await open("?org=not-a-uuid")).location).toBe("https://lista.team/dashboard");
    expect(mocks.setActiveTeam).not.toHaveBeenCalled();
  });

  it("goes to the dashboard when the director is on none of the club's teams, or the switch fails", async () => {
    mocks.tables.organization_members = { role: "director" };
    mocks.tables.team_members = [];
    expect((await open(`?org=${ORG}`)).location).toBe("https://lista.team/dashboard");

    mocks.tables.team_members = [{ team_id: "t-club" }];
    mocks.setActiveTeam.mockResolvedValue({ error: "Not a member of this team" });
    expect((await open(`?org=${ORG}`)).location).toBe("https://lista.team/dashboard");
  });
});
