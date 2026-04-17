import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenant } from "@/lib/supabase/tenant";

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";

  // ── Tenant resolution ───────────────────────────────────────────────────────
  // Resolve before session refresh so x-tenant-* headers are present on the
  // final response and readable by Server Components via getTenantFromHeaders().

  const tenant = await resolveTenant(hostname);

  // Subdomain resolves to a non-club org → redirect to the default domain.
  // This guards against free orgs that somehow have a subdomain set in the DB.
  if (
    tenant &&
    !tenant.isWhiteLabel &&
    hostname.includes(".")
  ) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname, "https://lista.team")
    );
  }

  // Proceed with session refresh (handles auth redirects)
  const response = await updateSession(request);

  // Inject tenant headers so Server Components can read them without an
  // additional Redis/DB round-trip via getTenantFromHeaders(headers()).
  if (tenant) {
    response.headers.set("x-tenant-id", tenant.organizationId);
    response.headers.set("x-tenant-slug", tenant.slug);
    response.headers.set("x-tenant-plan", tenant.plan);
    response.headers.set("x-tenant-is-white-label", String(tenant.isWhiteLabel));
    if (tenant.brandColor) response.headers.set("x-tenant-brand-color", tenant.brandColor);
    if (tenant.brandColorSecondary) response.headers.set("x-tenant-brand-color-secondary", tenant.brandColorSecondary);
    if (tenant.logoUrl) response.headers.set("x-tenant-logo-url", tenant.logoUrl);
    if (tenant.faviconUrl) response.headers.set("x-tenant-favicon-url", tenant.faviconUrl);
    if (tenant.orgNamePublic) response.headers.set("x-tenant-org-name", tenant.orgNamePublic);
    if (tenant.subdomain) response.headers.set("x-tenant-subdomain", tenant.subdomain);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
