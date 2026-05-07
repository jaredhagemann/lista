import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";

// Subdomains reserved for Lista infrastructure — never assignable to a club org.
const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "mail", "admin", "blog", "help", "status",
  "static", "assets", "cdn", "staging", "dev", "test", "demo",
]);

/**
 * PATCH /api/club/settings
 *
 * Updates branding/subdomain fields on an organization and invalidates the
 * Redis tenant cache for any affected hostnames so the next request re-reads
 * from the DB.
 *
 * Restricted to org owners (organization_members.role = 'owner').
 *
 * Body (all fields optional):
 *   {
 *     orgId: string,
 *     orgNamePublic?: string,
 *     brandColor?: string,
 *     brandColorSecondary?: string,
 *     subdomain?: string,
 *   }
 */
export async function PATCH(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, orgName, orgNamePublic, brandColor, brandColorSecondary, subdomain, logoUrl, faviconUrl } =
    body as {
      orgId?: string;
      orgName?: string;
      orgNamePublic?: string;
      brandColor?: string;
      brandColorSecondary?: string;
      subdomain?: string;
      logoUrl?: string | null;
      faviconUrl?: string | null;
    };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  const admin = adminClient();

  // Verify caller is an org owner or director
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profile.id)
    .single();

  if (!membership || !["owner", "director"].includes(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Branding/subdomain/logo fields are owner-only
  const isOwner = membership.role === "owner";
  if (
    !isOwner &&
    (brandColor !== undefined ||
      brandColorSecondary !== undefined ||
      subdomain !== undefined ||
      logoUrl !== undefined ||
      faviconUrl !== undefined)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Fetch current org — needed for cache invalidation and plan/subdomain validation
  const { data: currentOrg } = await admin
    .from("organizations")
    .select("subdomain, subdomain_status, plan")
    .eq("id", orgId)
    .single();

  // Normalise to lowercase so reserved-word checks are case-insensitive and
  // the stored value always satisfies DNS label rules.
  const normalisedSubdomain =
    subdomain !== undefined && subdomain !== null
      ? subdomain.toLowerCase()
      : subdomain;

  // Only club-plan orgs may claim a subdomain
  if (normalisedSubdomain !== undefined && normalisedSubdomain !== null && normalisedSubdomain !== "") {
    if (currentOrg?.plan !== "club") {
      return NextResponse.json(
        { error: "subdomain_requires_club_plan" },
        { status: 403 }
      );
    }
    // DNS label rules: lowercase alphanumeric, hyphens in the middle only, max 63 chars
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalisedSubdomain) || normalisedSubdomain.length > 63) {
      return NextResponse.json(
        { error: "subdomain_invalid_format" },
        { status: 400 }
      );
    }
    if (RESERVED_SUBDOMAINS.has(normalisedSubdomain)) {
      return NextResponse.json(
        { error: "subdomain_reserved" },
        { status: 409 }
      );
    }
  }

  // Build the update payload from only the fields that were provided.
  //
  // Subdomain changes require special handling (spec §1.10):
  //   • Setting a new value  → mark 'active', clear quarantine timestamp
  //   • Clearing (empty str) → quarantine rather than hard-delete, so old links
  //     and cache entries cannot be immediately hijacked by another org
  const updates: Record<string, string | null> = {};
  if (orgName !== undefined) updates.name = orgName || null;
  if (orgNamePublic !== undefined) updates.org_name_public = orgNamePublic || null;
  if (brandColor !== undefined) updates.brand_color = brandColor || null;
  if (brandColorSecondary !== undefined) updates.brand_color_secondary = brandColorSecondary || null;
  if (logoUrl !== undefined) updates.logo_url = logoUrl ?? null;
  if (faviconUrl !== undefined) updates.favicon_url = faviconUrl ?? null;
  if (normalisedSubdomain !== undefined) {
    if (normalisedSubdomain) {
      // New value — activate
      updates.subdomain = normalisedSubdomain;
      updates.subdomain_status = "active";
      updates.subdomain_quarantined_at = null;
    } else if (currentOrg?.subdomain) {
      // Clearing an existing subdomain — quarantine, keep the value on the row
      updates.subdomain_status = "quarantined";
      updates.subdomain_quarantined_at = new Date().toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await admin
    .from("organizations")
    .update(updates)
    .eq("id", orgId);

  if (error) {
    // Unique constraint violation on subdomain column
    if (error.code === "23505") {
      return NextResponse.json({ error: "subdomain_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Invalidate Redis cache for all hostnames this org could be reached at.
  // If the subdomain changed, both the old and new hostname need busting.
  const BASE_DOMAIN = "lista.team";
  const invalidations: Promise<void>[] = [];

  if (currentOrg?.subdomain) {
    invalidations.push(
      invalidateTenantCache(`${currentOrg.subdomain}.${BASE_DOMAIN}`)
    );
  }
  if (normalisedSubdomain && normalisedSubdomain !== currentOrg?.subdomain) {
    invalidations.push(
      invalidateTenantCache(`${normalisedSubdomain}.${BASE_DOMAIN}`)
    );
  }

  await Promise.all(invalidations);

  return NextResponse.json({ ok: true });
}
