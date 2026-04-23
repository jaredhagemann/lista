import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { invalidateTenantCache } from "@/lib/supabase/tenant";

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
 *
 * Sprint 5 extends this route with logo/favicon upload and full org settings.
 */
export async function PATCH(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, orgName, orgNamePublic, brandColor, brandColorSecondary, subdomain } =
    body as {
      orgId?: string;
      orgName?: string;
      orgNamePublic?: string;
      brandColor?: string;
      brandColorSecondary?: string;
      subdomain?: string;
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

  // Branding/subdomain fields are owner-only
  const isOwner = membership.role === "owner";
  if (!isOwner && (brandColor !== undefined || brandColorSecondary !== undefined || subdomain !== undefined)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Fetch current org so we can invalidate the old subdomain cache key too
  const { data: currentOrg } = await admin
    .from("organizations")
    .select("subdomain")
    .eq("id", orgId)
    .single();

  // Build the update payload from only the fields that were provided
  const updates: Record<string, string | null> = {};
  if (orgName !== undefined) updates.name = orgName || null;
  if (orgNamePublic !== undefined) updates.org_name_public = orgNamePublic || null;
  if (brandColor !== undefined) updates.brand_color = brandColor || null;
  if (brandColorSecondary !== undefined) updates.brand_color_secondary = brandColorSecondary || null;
  if (subdomain !== undefined) updates.subdomain = subdomain || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { error } = await admin
    .from("organizations")
    .update(updates)
    .eq("id", orgId);

  if (error) {
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
  if (subdomain && subdomain !== currentOrg?.subdomain) {
    invalidations.push(
      invalidateTenantCache(`${subdomain}.${BASE_DOMAIN}`)
    );
  }

  await Promise.all(invalidations);

  return NextResponse.json({ ok: true });
}
