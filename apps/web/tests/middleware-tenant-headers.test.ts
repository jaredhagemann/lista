/**
 * The app trusts x-tenant-* request headers, so only the middleware may set them
 * (BUG-043). A client that sent its own could choose the club name and logo a
 * response is built with, including those of a signup's confirmation email.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/supabase/tenant";

const mocks = vi.hoisted(() => ({
  tenant: null as unknown,
  forwarded: null as Headers | null,
}));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  resolveTenant: async () => mocks.tenant,
}));
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (_request: unknown, headers: Headers) => {
    mocks.forwarded = headers;
    return new Response();
  },
}));

import { middleware } from "@/middleware";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import { LISTA_BRAND, tenantEmailBrand } from "@/emails/brand";

const SPOOFED = {
  "x-tenant-id": "spoofed-org",
  "x-tenant-slug": "spoofed",
  "x-tenant-plan": "club_large",
  "x-tenant-is-white-label": "true",
  "x-tenant-brand-color": "#000000",
  "x-tenant-brand-color-secondary": "#000000",
  "x-tenant-logo-url": "https://evil.example/logo.png",
  "x-tenant-favicon-url": "https://evil.example/favicon.png",
  "x-tenant-org-name": "Totally Your Bank",
  "x-tenant-subdomain": "spoofed",
};

const SLOFC: TenantContext = {
  organizationId: "org-slo",
  slug: "slofc",
  plan: "club_small",
  brandColor: "#112233",
  brandColorSecondary: "#445566",
  logoUrl: "https://x/slofc.png",
  faviconUrl: "https://x/slofc-favicon.png",
  orgNamePublic: "SLOFC",
  subdomain: "slofc",
  isWhiteLabel: true,
};

async function forwardedFor(host: string, headers: Record<string, string>) {
  await middleware(new NextRequest(new URL(`https://${host}/login`), { headers: { host, ...headers } }));
  return mocks.forwarded!;
}

const tenantHeaders = (headers: Headers) => [...headers.keys()].filter((name) => name.startsWith("x-tenant-"));

beforeEach(() => {
  mocks.tenant = null;
  mocks.forwarded = null;
});

describe("tenant headers on Lista's own domain", () => {
  it("forwards none of the ones a client sent", async () => {
    const forwarded = await forwardedFor("www.lista.team", SPOOFED);

    expect(tenantHeaders(forwarded)).toEqual([]);
    expect(getTenantFromHeaders(forwarded)).toBeNull();
  });

  it("clears ones the app doesn't read yet, too", async () => {
    expect(tenantHeaders(await forwardedFor("lista.team", { "x-tenant-new-thing": "spoofed" }))).toEqual([]);
  });

  it("leaves a signup's email with Lista's brand", async () => {
    const forwarded = await forwardedFor("www.lista.team", SPOOFED);

    expect(tenantEmailBrand(getTenantFromHeaders(forwarded))).toEqual(LISTA_BRAND);
  });

  it("leaves other headers alone", async () => {
    const forwarded = await forwardedFor("www.lista.team", { ...SPOOFED, "x-other": "kept" });

    expect(forwarded.get("x-other")).toBe("kept");
  });
});

describe("tenant headers on a club's domain", () => {
  beforeEach(() => {
    mocks.tenant = SLOFC;
  });

  it("forwards the club's, with or without a client's in the way", async () => {
    for (const headers of [{}, SPOOFED]) {
      expect(getTenantFromHeaders(await forwardedFor("slofc.lista.team", headers))).toEqual(SLOFC);
    }
  });

  // The middleware only sets these when the club has them, so a client's would otherwise stay.
  it("doesn't let a client fill in what the club has left blank", async () => {
    mocks.tenant = { ...SLOFC, logoUrl: null, faviconUrl: null, orgNamePublic: null, brandColor: null };

    const forwarded = await forwardedFor("slofc.lista.team", SPOOFED);

    expect(forwarded.get("x-tenant-logo-url")).toBeNull();
    expect(forwarded.get("x-tenant-favicon-url")).toBeNull();
    expect(forwarded.get("x-tenant-org-name")).toBeNull();
    expect(forwarded.get("x-tenant-brand-color")).toBeNull();
    expect(forwarded.get("x-tenant-id")).toBe("org-slo");
  });
});
