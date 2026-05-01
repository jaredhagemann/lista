import { createClient } from "@supabase/supabase-js";
import { getRedis } from "@/lib/supabase/redis";
import type { Database } from "@/types/database";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TenantContext = {
  organizationId: string;
  slug: string;
  plan: "free" | "club";
  brandColor: string | null;
  brandColorSecondary: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  orgNamePublic: string | null;
  subdomain: string | null;
  isWhiteLabel: boolean; // plan === 'club'
};

// ── Internal helpers ──────────────────────────────────────────────────────────

const BASE_DOMAIN = "lista.team";

// Service-role client for tenant lookups — lightweight, no cookie parsing.
function tenantDbClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function cacheKey(hostname: string) {
  return `tenant:${hostname}`;
}

const CACHE_TTL_SECONDS = 60;

// ── resolveTenant ─────────────────────────────────────────────────────────────

/**
 * Resolves the tenant (organization) for an incoming hostname.
 *
 * Resolution order:
 *   1. Strip port suffix (for local dev: lista.team:3000)
 *   2. Honour TENANT_OVERRIDE_HOSTNAME env var (local dev without /etc/hosts)
 *   3. Default hostnames (lista.team, www.lista.team) → null immediately
 *   4. Redis cache hit → return cached TenantContext
 *   5. Cache miss → DB lookup → cache result → return
 *
 * Returns null for the default Lista tenant (no white-label active).
 */
export async function resolveTenant(
  rawHostname: string
): Promise<TenantContext | null> {
  // 1. Strip port
  const hostname =
    (process.env.TENANT_OVERRIDE_HOSTNAME ?? rawHostname).split(":")[0];

  // 3. Default tenant
  if (
    hostname === BASE_DOMAIN ||
    hostname === `www.${BASE_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) {
    return null;
  }

  // 4. Redis cache
  const r = getRedis();
  const cached = await r.get<TenantContext | "null">(cacheKey(hostname));
  if (cached !== null && cached !== undefined) {
    return cached === "null" ? null : cached;
  }

  // 5. DB lookup
  const db = tenantDbClient();
  let org: Database["public"]["Tables"]["organizations"]["Row"] | null = null;

  // Subdomain pattern: <slug>.lista.team
  if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
    const subdomain = hostname.slice(0, -(`.${BASE_DOMAIN}`.length));
    const { data } = await db
      .from("organizations")
      .select("*")
      .eq("subdomain", subdomain)
      .eq("subdomain_status", "active")
      .maybeSingle();
    org = data;
  } else {
    // Custom domain (Phase 2) — look up by custom_domain
    const { data } = await db
      .from("organizations")
      .select("*")
      .eq("custom_domain", hostname)
      .maybeSingle();
    org = data;
  }

  if (!org) {
    // Cache negative result so repeated misses don't hit the DB
    await r.set(cacheKey(hostname), "null", { ex: CACHE_TTL_SECONDS });
    return null;
  }

  const tenant: TenantContext = {
    organizationId: org.id,
    slug: org.slug,
    plan: org.plan as "free" | "club",
    brandColor: org.brand_color ?? null,
    brandColorSecondary: org.brand_color_secondary ?? null,
    logoUrl: org.logo_url ?? null,
    faviconUrl: org.favicon_url ?? null,
    orgNamePublic: org.org_name_public ?? null,
    subdomain: org.subdomain ?? null,
    isWhiteLabel: org.plan === "club",
  };

  await r.set(cacheKey(hostname), tenant, { ex: CACHE_TTL_SECONDS });
  return tenant;
}

// ── getTenantFromHeaders ──────────────────────────────────────────────────────

/**
 * Reads the x-tenant-* headers injected by middleware and returns a
 * TenantContext, or null if the current request is on the default Lista tenant.
 *
 * Use this in Server Components and Server Actions to access tenant data
 * without an additional DB or Redis round-trip.
 */
export function getTenantFromHeaders(
  headers: ReadonlyHeaders
): TenantContext | null {
  const id = headers.get("x-tenant-id");
  if (!id) return null;

  return {
    organizationId: id,
    slug: headers.get("x-tenant-slug") ?? "",
    plan: (headers.get("x-tenant-plan") as "free" | "club") ?? "free",
    brandColor: headers.get("x-tenant-brand-color"),
    brandColorSecondary: headers.get("x-tenant-brand-color-secondary"),
    logoUrl: headers.get("x-tenant-logo-url"),
    faviconUrl: headers.get("x-tenant-favicon-url"),
    orgNamePublic: headers.get("x-tenant-org-name"),
    subdomain: headers.get("x-tenant-subdomain"),
    isWhiteLabel: headers.get("x-tenant-is-white-label") === "true",
  };
}

// ── invalidateTenantCache ─────────────────────────────────────────────────────

/**
 * Deletes the cached tenant entry for a hostname.
 * Call this whenever an org's subdomain, plan, or branding changes.
 */
export async function invalidateTenantCache(hostname: string): Promise<void> {
  await getRedis().del(cacheKey(hostname));
}
