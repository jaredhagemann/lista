/**
 * Unit tests for src/middleware.ts
 *
 * Strategy:
 *   - resolveTenant is mocked — tests focus on routing/header logic, not DB
 *   - updateSession is mocked — avoids Next.js cookie/request-scope errors
 *   - NextRequest is constructed directly (no full Next.js runtime required)
 *
 * Covers:
 *   - *.lista.team subdomains with no valid club tenant → 302 to lista.team
 *   - *.lista.team subdomains with a free-plan tenant → 302 to lista.team
 *   - *.lista.team subdomains with a club-plan tenant → pass through
 *   - Default lista.team hostname → pass through
 *   - x-tenant-* headers set on request AND response when tenant resolves
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { TenantContext } from "@/lib/supabase/tenant";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockResolveTenant = vi.hoisted(() => vi.fn<[string], Promise<TenantContext | null>>());

vi.mock("@/lib/supabase/tenant", () => ({
  resolveTenant: mockResolveTenant,
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn().mockImplementation(
    (_req: NextRequest, requestHeaders?: Headers) =>
      Promise.resolve(
        NextResponse.next({ request: { headers: requestHeaders } })
      )
  ),
}));

import { middleware } from "@/middleware";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(hostname: string, path = "/dashboard") {
  return new NextRequest(`http://${hostname}${path}`, {
    headers: { host: hostname },
  });
}

const clubTenant: TenantContext = {
  organizationId: "org-abc",
  slug: "jogafc",
  plan: "club",
  isWhiteLabel: true,
  brandColor: "#1a1a2e",
  brandColorSecondary: null,
  logoUrl: "https://cdn.example.com/logo.png",
  faviconUrl: null,
  orgNamePublic: "Joga FC",
  subdomain: "jogafc",
};

const freeTenant: TenantContext = {
  ...clubTenant,
  plan: "free",
  isWhiteLabel: false,
};

beforeEach(() => {
  mockResolveTenant.mockReset();
});

// ── Redirect behaviour ────────────────────────────────────────────────────────

describe("middleware — subdomain redirect", () => {
  it("redirects an unknown *.lista.team subdomain to lista.team", async () => {
    mockResolveTenant.mockResolvedValue(null);

    const response = await middleware(makeRequest("ghost.lista.team"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("lista.team");
  });

  it("redirects a downgraded subdomain (resolveTenant returns null) to lista.team", async () => {
    mockResolveTenant.mockResolvedValue(null);

    const response = await middleware(makeRequest("oldclub.lista.team"));

    expect(response.status).toBe(307);
  });

  it("redirects a free-plan org that still has a subdomain set", async () => {
    mockResolveTenant.mockResolvedValue(freeTenant);

    const response = await middleware(makeRequest("jogafc.lista.team"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("lista.team");
  });

  it("preserves the request path in the redirect URL", async () => {
    mockResolveTenant.mockResolvedValue(null);

    const response = await middleware(makeRequest("oldclub.lista.team", "/dashboard/events"));

    expect(response.headers.get("location")).toContain("/dashboard/events");
  });
});

// ── Pass-through behaviour ────────────────────────────────────────────────────

describe("middleware — pass-through", () => {
  it("does not redirect a valid club-plan subdomain", async () => {
    mockResolveTenant.mockResolvedValue(clubTenant);

    const response = await middleware(makeRequest("jogafc.lista.team"));

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("does not redirect the default lista.team hostname", async () => {
    mockResolveTenant.mockResolvedValue(null);

    const response = await middleware(makeRequest("lista.team"));

    expect(response.status).not.toBe(307);
  });
});

// ── Header injection ──────────────────────────────────────────────────────────

describe("middleware — tenant header injection", () => {
  it("sets x-tenant-* on the response when a club tenant resolves", async () => {
    mockResolveTenant.mockResolvedValue(clubTenant);

    const response = await middleware(makeRequest("jogafc.lista.team"));

    expect(response.headers.get("x-tenant-id")).toBe("org-abc");
    expect(response.headers.get("x-tenant-slug")).toBe("jogafc");
    expect(response.headers.get("x-tenant-plan")).toBe("club");
    expect(response.headers.get("x-tenant-is-white-label")).toBe("true");
    expect(response.headers.get("x-tenant-brand-color")).toBe("#1a1a2e");
    expect(response.headers.get("x-tenant-logo-url")).toBe("https://cdn.example.com/logo.png");
    expect(response.headers.get("x-tenant-org-name")).toBe("Joga FC");
  });

  it("does not set x-tenant-* headers when no tenant resolves", async () => {
    mockResolveTenant.mockResolvedValue(null);

    const response = await middleware(makeRequest("lista.team"));

    expect(response.headers.get("x-tenant-id")).toBeNull();
  });

  it("forwards x-tenant-* headers into the downstream request via updateSession", async () => {
    mockResolveTenant.mockResolvedValue(clubTenant);

    const { updateSession } = await import("@/lib/supabase/middleware");

    await middleware(makeRequest("jogafc.lista.team"));

    const [_req, requestHeaders] = (updateSession as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect((requestHeaders as Headers).get("x-tenant-id")).toBe("org-abc");
    expect((requestHeaders as Headers).get("x-tenant-plan")).toBe("club");
  });
});
