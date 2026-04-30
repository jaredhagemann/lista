/**
 * Unit tests for invite helper functions (Sprint 4)
 *
 * Covers:
 *   - inviteBaseUrl: club+subdomain, club+custom_domain, club+neither, free plan, no org
 *   - inviteBranding: club org with values, club org with nulls, free plan, no org
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
      { plan: "club", subdomain: "jogafc", custom_domain: null },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://jogafc.lista.team");
  });

  it("prefers custom_domain over subdomain for a club org", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "club", subdomain: "jogafc", custom_domain: "app.jogafc.org" },
    );
    expect(await inviteBaseUrl("team-1")).toBe("https://app.jogafc.org");
  });

  it("falls back to NEXT_PUBLIC_APP_URL for a club org with no subdomain or custom_domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://lista.team";
    setupDb(
      { organization_id: "org-1" },
      { plan: "club", subdomain: null, custom_domain: null },
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
  it("returns brandName and logoUrl for a club org", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "club", org_name_public: "Joga FC", logo_url: "https://cdn.example.com/logo.png" },
    );
    const result = await inviteBranding("team-1");
    expect(result).toEqual({ brandName: "Joga FC", logoUrl: "https://cdn.example.com/logo.png" });
  });

  it("returns undefined values when club org has null org_name_public and logo_url", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "club", org_name_public: null, logo_url: null },
    );
    const result = await inviteBranding("team-1");
    expect(result).toEqual({ brandName: undefined, logoUrl: undefined });
  });

  it("returns both undefined for a free-plan org", async () => {
    setupDb(
      { organization_id: "org-1" },
      { plan: "free", org_name_public: "Some Club", logo_url: "https://cdn.example.com/logo.png" },
    );
    const result = await inviteBranding("team-1");
    expect(result).toEqual({ brandName: undefined, logoUrl: undefined });
  });

  it("returns both undefined when the team has no org", async () => {
    setupDb({ organization_id: null }, null);
    const result = await inviteBranding("team-1");
    expect(result).toEqual({ brandName: undefined, logoUrl: undefined });
  });
});
