/**
 * Unit tests for invite helper functions (Sprint 4)
 *
 * Covers:
 *   - inviteBaseUrl: club+subdomain, club+custom_domain, club+neither, free plan, no org
 *   - inviteBranding: the email brand for a club team, a club with nulls, a free team, no org
 *
 * Both helpers use adminClient() — mocked below.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── adminClient mock ──────────────────────────────────────────────────────────

const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  adminClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import { inviteBaseUrl, inviteBranding } from "@/lib/invitations/invite-base-url";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Configures mockFrom with a two-call sequence:
 *   call 1 — teams query → returns { data: teamRow }
 *   call 2 — organizations query → returns { data: orgRow }
 *
 * Pass orgRow = null to simulate no org found (or teamRow.organization_id = null).
 */
function setupDb(teamRow: { organization_id: string | null } | null, orgRow: object | null) {
  let callCount = 0;
  mockFrom.mockImplementation(() => {
    callCount++;
    const result = callCount === 1
      ? { data: teamRow, error: null }
      : { data: orgRow, error: null };
    // Chain: .select().eq().single() all return a promise-like object
    const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve(result) };
    return chain;
  });
}

beforeEach(() => {
  mockFrom.mockReset();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

// ── inviteBaseUrl ─────────────────────────────────────────────────────────────

describe("inviteBaseUrl", () => {
  it("returns subdomain URL for a club org with a subdomain", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "club_small", subdomain: "jogafc", custom_domain: null },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://jogafc.lista.team");
  });

  it("prefers custom_domain over subdomain for a club org", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "club_small", subdomain: "jogafc", custom_domain: "app.jogafc.org" },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://app.jogafc.org");
  });

  it("falls back to NEXT_PUBLIC_APP_URL for a club org with no subdomain or custom_domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://lista.team";
    setupDb(
      { organization_id: "org-1" },
      { plan: "club_small", subdomain: null, custom_domain: null },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://lista.team");
  });

  it("falls back for a free-plan org", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://lista.team";
    setupDb(
      { organization_id: "org-1" },
      { plan: "free", subdomain: "jogafc", custom_domain: null },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://lista.team");
  });

  it("falls back when the team has no org", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://lista.team";
    setupDb({ organization_id: null }, null);
    expect(await inviteBaseUrl("team-1")).toBe("https://lista.team");
  });

  it("uses https://lista.team as ultimate fallback when env var is unset", async () => {
    setupDb({ organization_id: null }, null);
    expect(await inviteBaseUrl("team-1")).toBe("https://lista.team");
  });
});

// ── inviteBranding ────────────────────────────────────────────────────────────

describe("inviteBranding", () => {
  // One query: the team with its club (TEAM_BRAND_COLUMNS). A club team's
  // invitation carries the club's brand; anything else carries lista's.
  function setupTeam(team: object | null) {
    const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve({ data: team, error: null }) };
    mockFrom.mockReturnValue(chain);
  }
  const LISTA = { name: "Lista", logoUrl: "https://www.lista.team/email/lista-mark.png", color: "#01D7F4", fromName: null };

  it("a club team: the club's public name, logo and secondary color, sent in its name", async () => {
    setupTeam({
      logo_url: null,
      organizations: {
        plan: "club_small",
        name: "Joga Futbol Club",
        org_name_public: "Joga FC",
        logo_url: "https://cdn.example.com/logo.png",
        brand_color_secondary: "#C8102E",
      },
    });
    expect(await inviteBranding("team-1")).toEqual({
      name: "Joga FC",
      logoUrl: "https://cdn.example.com/logo.png",
      color: "#C8102E",
      fromName: "Joga FC",
    });
  });

  it("a club team's own logo comes first", async () => {
    setupTeam({
      logo_url: "https://cdn.example.com/team.png",
      organizations: { plan: "club_small", name: "Joga", org_name_public: "Joga FC", logo_url: "https://cdn.example.com/logo.png" },
    });
    expect((await inviteBranding("team-1")).logoUrl).toBe("https://cdn.example.com/team.png");
  });

  it("a club without a public name, logo or color: its internal name, no logo, lista blue", async () => {
    setupTeam({
      logo_url: null,
      organizations: { plan: "club_small", name: "Joga Futbol Club", org_name_public: null, logo_url: null, brand_color_secondary: null },
    });
    expect(await inviteBranding("team-1")).toEqual({
      name: "Joga Futbol Club",
      logoUrl: null,
      color: "#01D7F4",
      fromName: "Joga Futbol Club",
    });
  });

  it("a free-plan team gets lista", async () => {
    setupTeam({
      logo_url: null,
      organizations: { plan: "free", name: "Some Club", org_name_public: "Some Club", logo_url: "https://cdn.example.com/logo.png" },
    });
    expect(await inviteBranding("team-1")).toEqual(LISTA);
  });

  it("a team with no org gets lista", async () => {
    setupTeam({ logo_url: null, organizations: null });
    expect(await inviteBranding("team-1")).toEqual(LISTA);
  });
});
