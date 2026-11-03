// @vitest-environment jsdom
/**
 * The dashboard layout fetches each team's club branding
 * (spec: docs/specs/team-branding-and-labels.md §2–4).
 *
 * The header and team picker brand a club team from its organization (logo,
 * public name, plan). The layout's membership query has to ask for them, and
 * hand them on: a view given the right props can't notice a query that drops
 * them, so this renders the layout itself.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const selects: Array<{ table: string; columns: string }> = [];
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null, count: 0 });
    const chain: Record<string, unknown> = {
      select: (columns: string) => {
        selects.push({ table, columns });
        return chain;
      },
    };
    for (const m of ["eq", "neq", "in", "gt", "order", "limit", "is"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown) => result().then(res);
    return chain;
  };
  return {
    selects,
    tables,
    navProps: null as Record<string, unknown> | null,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) } },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantFromHeaders: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/layout/dashboard-nav", () => ({
  DashboardNav: (props: Record<string, unknown>) => {
    mocks.navProps = props;
    return null;
  },
}));

vi.mock("@/components/layout/session-watch", () => ({
  SessionWatch: ({ userId }: { userId: string }) => <span data-testid="session-watch">{userId}</span>,
}));

import { screen } from "@testing-library/react";
import DashboardLayout, { generateMetadata } from "@/app/dashboard/layout";

const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: "https://x/slofc.png", plan: "club_small" };

describe("the dashboard layout", () => {
  it("asks for each team's club branding, and hands it to the header", async () => {
    mocks.tables.profiles = { id: "u-1", active_team_id: "t-1" };
    mocks.tables.profile_managers = [];
    mocks.tables.team_members = [
      {
        id: "m-1",
        team_id: "t-1",
        profile_id: "u-1",
        role: "coach",
        teams: { id: "t-1", name: "12U Girls", logo_url: null, organization_id: "org-1", organizations: SLOFC },
      },
    ];

    render(await DashboardLayout({ children: null }));

    const membershipQuery = mocks.selects.find((s) => s.table === "team_members" && s.columns.includes("teams("));
    expect(membershipQuery?.columns).toMatch(/organizations\([^)]*name[^)]*\)/);
    for (const column of ["org_name_public", "logo_url", "plan"]) {
      expect(membershipQuery?.columns).toContain(column);
    }
    const memberships = mocks.navProps?.allMemberships as Array<{ teams: { organizations: unknown } }>;
    expect(memberships[0].teams.organizations).toEqual(SLOFC);
  });

  // BUG-042: a club with no subdomain has no tenant, so the active team is what brands the page.
  describe("the favicon", () => {
    const FAVICON = "https://x/slofc-favicon.png";
    const onTeam = (organizations: unknown) => {
      mocks.tables.profiles = { id: "u-1", active_team_id: "t-1" };
      mocks.tables.profile_managers = [];
      mocks.tables.team_members = [
        {
          id: "m-1",
          team_id: "t-1",
          profile_id: "u-1",
          role: "coach",
          teams: { id: "t-1", name: "12U Girls", logo_url: "https://x/team.png", organization_id: "org-1", organizations },
        },
      ];
    };

    it("asks for the club's favicon", async () => {
      onTeam(SLOFC);
      mocks.selects.length = 0;

      await generateMetadata();

      const query = mocks.selects.find((s) => s.table === "team_members" && s.columns.includes("teams("));
      expect(query?.columns).toContain("favicon_url");
    });

    it("is the active club team's", async () => {
      onTeam({ ...SLOFC, favicon_url: FAVICON });

      expect((await generateMetadata()).icons).toEqual({ icon: { url: FAVICON } });
    });

    it("is the club's logo when the club has no favicon", async () => {
      onTeam({ ...SLOFC, favicon_url: null });

      expect((await generateMetadata()).icons).toEqual({ icon: { url: SLOFC.logo_url } });
    });

    it("is left to the root layout for a team outside a club, even with its own logo", async () => {
      onTeam({ name: "Rec", org_name_public: null, logo_url: null, favicon_url: FAVICON, plan: "free" });

      expect((await generateMetadata()).icons).toBeUndefined();
    });

    it("is left to the root layout with no team", async () => {
      mocks.tables.profiles = { id: "u-1", active_team_id: null };
      mocks.tables.profile_managers = [];
      mocks.tables.team_members = [];

      expect((await generateMetadata()).icons).toBeUndefined();
    });
  });

  // BUG-036: the page watches the session for the account it was rendered for.
  it("watches the session for the signed-in account", async () => {
    mocks.tables.profiles = { id: "u-1", active_team_id: null };
    mocks.tables.profile_managers = [];
    mocks.tables.team_members = [];

    render(await DashboardLayout({ children: null }));

    expect(screen.getByTestId("session-watch").textContent).toBe("u-1");
  });
});
