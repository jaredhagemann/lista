/**
 * BUG-026: an event link for a team other than the active one opens it.
 *
 * Someone on two teams (a coach of both, a guardian with a child on each) who
 * followed a link to their other team's event was sent to the dashboard: the
 * event page took "not the active team" to mean "no access". Now the page hands
 * off to /dashboard/switch-team, which switches through the team picker's own
 * setActiveTeam (it checks membership and sets the "viewing as" cookie, which a
 * page can't) and comes straight back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "order", "limit", "is", "not"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
    membership: null as unknown,
    setActiveTeam: vi.fn(),
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) } },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/get-active-membership", () => ({ getActiveMembership: async () => mocks.membership }));
vi.mock("@/app/actions/team", () => ({ setActiveTeam: mocks.setActiveTeam }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/calendar/event-detail", () => ({ EventDetail: () => null }));

import EventDetailPage from "@/app/dashboard/schedule/[eventId]/page";
import { GET as switchTeam } from "@/app/dashboard/switch-team/route";

const EVENT = { id: "evt-1", team_id: "team-b", title: "Practice", event_type: "practice", profiles: null, locations: null };
const TEAM_A = { team_id: "team-a", role: "coach", profile_id: "coach-1", teams: { id: "team-a", name: "A" } };

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.tables.events = EVENT;
  mocks.membership = TEAM_A;
});

async function openEvent(searchParams: Record<string, string> = {}) {
  try {
    await EventDetailPage({ params: Promise.resolve({ eventId: "evt-1" }), searchParams: Promise.resolve(searchParams) });
    return null;
  } catch (err) {
    return (err as Error).message.replace(/^redirect /, "");
  }
}

describe("the event page, for an event of another team", () => {
  it("hands off to the team switch, returning to this page", async () => {
    const to = await openEvent();

    const url = new URL(to!, "https://lista.test");
    expect(url.pathname).toBe("/dashboard/switch-team");
    expect(url.searchParams.get("team")).toBe("team-b");
    expect(url.searchParams.get("next")).toBe("/dashboard/schedule/evt-1");
  });

  it("keeps the page's query in the way back", async () => {
    const to = await openEvent({ edit: "true" });

    expect(new URL(to!, "https://lista.test").searchParams.get("next")).toBe("/dashboard/schedule/evt-1?edit=true");
  });

  it("goes to the dashboard if a switch already happened and still doesn't match", async () => {
    expect(await openEvent({ switched: "1" })).toBe("/dashboard");
  });
});

function switchRequest(query: string) {
  return new Request(`https://lista.test/dashboard/switch-team?${query}`);
}

function locationOf(response: Response) {
  const url = new URL(response.headers.get("location")!);
  return url.pathname + url.search;
}

describe("the team switch", () => {
  it("switches through setActiveTeam, then returns to the page, marked switched", async () => {
    mocks.setActiveTeam.mockResolvedValue({ success: true });

    const response = await switchTeam(switchRequest("team=team-b&next=%2Fdashboard%2Fschedule%2Fevt-1%3Fedit%3Dtrue"));

    expect(mocks.setActiveTeam).toHaveBeenCalledWith("team-b");
    expect(locationOf(response)).toBe("/dashboard/schedule/evt-1?edit=true&switched=1");
  });

  it("sends someone who isn't on the team to the dashboard", async () => {
    mocks.setActiveTeam.mockResolvedValue({ error: "Not a member of this team" });

    const response = await switchTeam(switchRequest("team=team-b&next=%2Fdashboard%2Fschedule%2Fevt-1"));

    expect(locationOf(response)).toBe("/dashboard");
  });

  it("never returns off the site", async () => {
    mocks.setActiveTeam.mockResolvedValue({ success: true });

    const response = await switchTeam(switchRequest("team=team-b&next=%2F%2Fevil.example"));

    expect(new URL(response.headers.get("location")!).host).toBe("lista.test");
    expect(locationOf(response)).toBe("/dashboard?switched=1");
  });

  it("does nothing without a team", async () => {
    const response = await switchTeam(switchRequest("next=%2Fdashboard"));

    expect(mocks.setActiveTeam).not.toHaveBeenCalled();
    expect(locationOf(response)).toBe("/dashboard");
  });
});
