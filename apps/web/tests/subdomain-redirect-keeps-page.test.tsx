/**
 * BUG-027: the club-subdomain redirect keeps the page it was asked for.
 *
 * The dashboard layout sends a club-team user who isn't on their club's
 * subdomain there, and a free-team user on a subdomain back to lista.team. Both
 * went to /dashboard, whatever page was asked for. Email links point at
 * lista.team, so an answer link recorded its answer (the page renders beside the
 * layout) and then landed on the club's dashboard instead of the event. The
 * middleware now forwards the requested path, and the redirects keep it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "gt", "order", "limit", "is"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown) => result().then(res);
    return chain;
  };
  return {
    tables,
    requestHeaders: new Headers(),
    tenant: null as unknown,
    forwarded: null as Headers | null,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) } },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => mocks.requestHeaders,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/supabase/tenant", () => ({
  getTenantFromHeaders: () => mocks.tenant,
  resolveTenant: async () => null,
}));
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (_request: unknown, headers: Headers) => {
    mocks.forwarded = headers;
    return new Response(null);
  },
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/layout/dashboard-nav", () => ({ DashboardNav: () => null }));

import DashboardLayout from "@/app/dashboard/layout";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const CLUB_ORG = { subdomain: "slofc", subdomain_status: "active", plan: "club_small", subscription_status: "active", closed_at: null };
const FREE_ORG = { subdomain: null, subdomain_status: null, plan: "free", subscription_status: null, closed_at: null };

function onTeamOf(org: unknown) {
  mocks.tables.profiles = { id: "u-1", active_team_id: "t-1" };
  mocks.tables.profile_managers = [];
  mocks.tables.team_members = [
    { id: "m-1", team_id: "t-1", profile_id: "u-1", role: "player", teams: { id: "t-1", name: "12U Girls", organization_id: "org-1" } },
  ];
  mocks.tables.organization_members = null;
  mocks.tables.organizations = org;
}

async function redirectFor(requestPath: string | null) {
  mocks.requestHeaders = new Headers(requestPath ? { "x-request-path": requestPath } : {});
  try {
    await DashboardLayout({ children: null });
    return null;
  } catch (err) {
    return (err as Error).message.replace(/^redirect /, "");
  }
}

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.tenant = null;
  vi.unstubAllEnvs();
});

describe("the dashboard layout's host redirects", () => {
  it("sends a club team's member on lista.team to the same page and query on the club's subdomain", async () => {
    onTeamOf(CLUB_ORG);

    expect(await redirectFor("/dashboard/schedule/e1?answer=available&for=p1")).toBe(
      "https://slofc.lista.team/dashboard/schedule/e1?answer=available&for=p1"
    );
  });

  it("sends a free team's member on a subdomain to the same page on lista.team", async () => {
    onTeamOf(FREE_ORG);
    mocks.tenant = { subdomain: "slofc", isWhiteLabel: true };

    expect(await redirectFor("/dashboard/team")).toBe("https://lista.team/dashboard/team");
  });

  it("falls back to the dashboard without a path, or with one that isn't a dashboard page", async () => {
    onTeamOf(CLUB_ORG);

    expect(await redirectFor(null)).toBe("https://slofc.lista.team/dashboard");
    expect(await redirectFor("//evil.example/dashboard")).toBe("https://slofc.lista.team/dashboard");
    expect(await redirectFor("/login")).toBe("https://slofc.lista.team/dashboard");
  });

  it("leaves someone already on the right host alone", async () => {
    onTeamOf(CLUB_ORG);
    mocks.tenant = { subdomain: "slofc", isWhiteLabel: true };

    expect(await redirectFor("/dashboard/schedule/e1")).toBeNull();
  });
});

describe("the middleware", () => {
  it("forwards the requested path and query", async () => {
    await middleware(new NextRequest(new URL("https://lista.team/dashboard/schedule/e1?answer=maybe&for=p1")));

    expect(mocks.forwarded?.get("x-request-path")).toBe("/dashboard/schedule/e1?answer=maybe&for=p1");
  });

  it("overwrites a path a client sent itself", async () => {
    await middleware(
      new NextRequest(new URL("https://lista.team/dashboard/team"), { headers: { "x-request-path": "/dashboard/evil" } })
    );

    expect(mocks.forwarded?.get("x-request-path")).toBe("/dashboard/team");
  });
});
