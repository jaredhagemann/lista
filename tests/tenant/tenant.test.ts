/**
 * Unit / integration tests for src/lib/supabase/tenant.ts
 *
 * Strategy:
 *   - Redis is mocked with an in-memory store (no real Upstash instance needed).
 *     @upstash/redis must be in vitest.config.rls.mts server.deps.inline so
 *     Vitest transforms it and vi.mock() can intercept it.
 *   - Supabase DB uses the real local stack (same as RLS tests).
 *   - Tests cover: default-host short-circuit, subdomain DB lookup, cache hit,
 *     negative caching, port stripping, TENANT_OVERRIDE_HOSTNAME, and the
 *     getTenantFromHeaders / invalidateTenantCache helpers.
 *
 * Requires: `supabase start`
 * Run via: pnpm test:integration
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  adminClient,
  cleanupTestData,
  trackIds,
} from "../rls/helpers";

// ── Redis mock ────────────────────────────────────────────────────────────────
// Mock the local redis wrapper (@/lib/supabase/redis) rather than the external
// @upstash/redis package — vi.mock reliably intercepts local app modules.
// vi.hoisted ensures the store is initialised before the mock factory runs.

const mockRedisStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/supabase/redis", () => ({
  getRedis: vi.fn().mockReturnValue({
    get: vi.fn((key: string) => Promise.resolve(mockRedisStore.get(key) ?? null)),
    set: vi.fn((key: string, value: unknown) => {
      mockRedisStore.set(key, value);
      return Promise.resolve("OK");
    }),
    del: vi.fn((key: string) => {
      mockRedisStore.delete(key);
      return Promise.resolve(1);
    }),
  }),
}));

import {
  resolveTenant,
  getTenantFromHeaders,
  invalidateTenantCache,
  type TenantContext,
} from "@/lib/supabase/tenant";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal headers-like object accepted by getTenantFromHeaders */
function makeHeaders(entries: Record<string, string>) {
  return { get: (key: string) => entries[key] ?? null };
}

afterAll(async () => {
  await cleanupTestData();
});

beforeEach(() => {
  mockRedisStore.clear();
  delete process.env.TENANT_OVERRIDE_HOSTNAME;
});

// ── getTenantFromHeaders ──────────────────────────────────────────────────────

describe("getTenantFromHeaders", () => {
  it("returns null when x-tenant-id is absent (default Lista tenant)", () => {
    expect(getTenantFromHeaders(makeHeaders({}))).toBeNull();
  });

  it("reconstructs a full TenantContext from injected headers", () => {
    const ctx = getTenantFromHeaders(
      makeHeaders({
        "x-tenant-id": "org-123",
        "x-tenant-slug": "jogafc",
        "x-tenant-plan": "club",
        "x-tenant-is-white-label": "true",
        "x-tenant-brand-color": "#ff0000",
        "x-tenant-brand-color-secondary": "#00ff00",
        "x-tenant-logo-url": "https://example.com/logo.png",
        "x-tenant-favicon-url": "https://example.com/fav.ico",
        "x-tenant-org-name": "Joga FC",
        "x-tenant-subdomain": "jogafc",
      })
    );

    expect(ctx).toEqual<TenantContext>({
      organizationId: "org-123",
      slug: "jogafc",
      plan: "club",
      isWhiteLabel: true,
      brandColor: "#ff0000",
      brandColorSecondary: "#00ff00",
      logoUrl: "https://example.com/logo.png",
      faviconUrl: "https://example.com/fav.ico",
      orgNamePublic: "Joga FC",
      subdomain: "jogafc",
    });
  });

  it("sets isWhiteLabel = false when header value is 'false'", () => {
    const ctx = getTenantFromHeaders(
      makeHeaders({ "x-tenant-id": "org-1", "x-tenant-is-white-label": "false" })
    );
    expect(ctx?.isWhiteLabel).toBe(false);
  });

  it("returns null for optional headers that are absent", () => {
    const ctx = getTenantFromHeaders(makeHeaders({ "x-tenant-id": "org-1" }));
    expect(ctx?.brandColor).toBeNull();
    expect(ctx?.logoUrl).toBeNull();
    expect(ctx?.subdomain).toBeNull();
  });
});

// ── resolveTenant — default hosts ─────────────────────────────────────────────

describe("resolveTenant — default hosts return null without touching DB or cache", () => {
  const defaults = [
    "lista.team",
    "www.lista.team",
    "localhost",
    "127.0.0.1",
    "lista.team:3000", // port should be stripped before the check
  ];

  for (const host of defaults) {
    it(`returns null for "${host}"`, async () => {
      expect(await resolveTenant(host)).toBeNull();
      expect(mockRedisStore.size).toBe(0); // Redis never consulted
    });
  }
});

// ── resolveTenant — TENANT_OVERRIDE_HOSTNAME ──────────────────────────────────

describe("resolveTenant — TENANT_OVERRIDE_HOSTNAME", () => {
  it("uses the override instead of the real hostname for the lookup", async () => {
    // Override points to a default host → should short-circuit to null
    // regardless of what rawHostname is passed.
    process.env.TENANT_OVERRIDE_HOSTNAME = "lista.team";
    expect(await resolveTenant("some-other-host.com")).toBeNull();
  });
});

// ── resolveTenant — DB lookup (real Supabase, mocked Redis) ───────────────────

describe("resolveTenant — DB lookup", () => {
  it("returns null and caches the miss for an unknown *.lista.team subdomain", async () => {
    const unknownSubdomain = `ghost-${crypto.randomUUID().slice(0, 8)}`;
    const hostname = `${unknownSubdomain}.lista.team`;

    expect(await resolveTenant(hostname)).toBeNull();
    expect(mockRedisStore.get(`tenant:${hostname}`)).toBe("null");
  });

  it("returns null for an unknown custom domain (Phase 2 path)", async () => {
    const hostname = `unknown-${crypto.randomUUID().slice(0, 8)}.example.com`;

    expect(await resolveTenant(hostname)).toBeNull();
    expect(mockRedisStore.get(`tenant:${hostname}`)).toBe("null");
  });

  it("resolves a club-plan org by subdomain and caches the TenantContext", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);
    trackIds({ orgId });

    const subdomain = `test-${crypto.randomUUID().slice(0, 8)}`;
    await adminClient
      .from("organizations")
      .update({ subdomain, plan: "club", org_name_public: "Test Club FC" })
      .eq("id", orgId);

    const hostname = `${subdomain}.lista.team`;
    const result = await resolveTenant(hostname);

    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe(orgId);
    expect(result!.subdomain).toBe(subdomain);
    expect(result!.plan).toBe("club");
    expect(result!.isWhiteLabel).toBe(true);
    expect(result!.orgNamePublic).toBe("Test Club FC");

    // Result should be cached for the next request
    expect(mockRedisStore.get(`tenant:${hostname}`)).toMatchObject({
      organizationId: orgId,
    });
  });

  it("returns the cached TenantContext on a second call without hitting the DB", async () => {
    const cachedTenant: TenantContext = {
      organizationId: "cached-org-id",
      slug: "cached",
      plan: "club",
      isWhiteLabel: true,
      brandColor: null,
      brandColorSecondary: null,
      logoUrl: null,
      faviconUrl: null,
      orgNamePublic: null,
      subdomain: "cached",
    };

    // Seed the Redis mock directly — no DB call should happen
    mockRedisStore.set("tenant:cached.lista.team", cachedTenant);

    expect(await resolveTenant("cached.lista.team")).toEqual(cachedTenant);
  });

  it("returns null from a cached 'null' sentinel without hitting the DB", async () => {
    mockRedisStore.set("tenant:expired-club.lista.team", "null");

    expect(await resolveTenant("expired-club.lista.team")).toBeNull();
  });
});

// ── invalidateTenantCache ─────────────────────────────────────────────────────

describe("invalidateTenantCache", () => {
  it("removes the tenant cache entry for the given hostname", async () => {
    mockRedisStore.set("tenant:jogafc.lista.team", { organizationId: "org-1" });

    await invalidateTenantCache("jogafc.lista.team");

    expect(mockRedisStore.has("tenant:jogafc.lista.team")).toBe(false);
  });

  it("is a no-op when the key does not exist", async () => {
    await expect(
      invalidateTenantCache("nonexistent.lista.team")
    ).resolves.not.toThrow();
  });
});
