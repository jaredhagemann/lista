import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveTenant } from "@/lib/supabase/tenant";

const BASE_DOMAIN = "lista.team";

export async function middleware(request: NextRequest) {
  // Strip port for local dev (lista.team:3000 → lista.team)
  const hostname = (request.headers.get("host") ?? "").split(":")[0];

  // A *.lista.team subdomain — not the apex or www, which are the default tenant.
  const isListaSubdomain =
    hostname.endsWith(`.${BASE_DOMAIN}`) &&
    hostname !== `www.${BASE_DOMAIN}`;

  // ── Tenant resolution ───────────────────────────────────────────────────────

  const tenant = await resolveTenant(hostname);

  // Any *.lista.team request that doesn't resolve to a valid club tenant must
  // redirect to lista.team. This covers:
  //   • Subdomains cleared after a billing downgrade (resolveTenant returns null)
  //   • Unknown/squatted subdomains (resolveTenant returns null)
  //   • Free orgs that somehow still have a subdomain set in the DB
  if (isListaSubdomain && (!tenant || !tenant.isWhiteLabel)) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname, `https://${BASE_DOMAIN}`)
    );
  }

  // Build the request-forwarded headers. Passing these into updateSession means
  // NextResponse.next({ request: { headers } }) carries them to the downstream
  // handler, where Server Components can read them via headers().
  const requestHeaders = new Headers(request.headers);
  if (tenant) {
    requestHeaders.set("x-tenant-id", tenant.organizationId);
    requestHeaders.set("x-tenant-slug", tenant.slug);
    requestHeaders.set("x-tenant-plan", tenant.plan);
    requestHeaders.set("x-tenant-is-white-label", String(tenant.isWhiteLabel));
    if (tenant.brandColor) requestHeaders.set("x-tenant-brand-color", tenant.brandColor);
    if (tenant.brandColorSecondary) requestHeaders.set("x-tenant-brand-color-secondary", tenant.brandColorSecondary);
    if (tenant.logoUrl) requestHeaders.set("x-tenant-logo-url", tenant.logoUrl);
    if (tenant.faviconUrl) requestHeaders.set("x-tenant-favicon-url", tenant.faviconUrl);
    if (tenant.orgNamePublic) requestHeaders.set("x-tenant-org-name", tenant.orgNamePublic);
    if (tenant.subdomain) requestHeaders.set("x-tenant-subdomain", tenant.subdomain);
  }

  // ── Session refresh + auth redirects ────────────────────────────────────────
  // Pass requestHeaders so they are forwarded into the downstream request and
  // are readable via headers() in Server Components and Server Actions.

  const response = await updateSession(request, requestHeaders);

  // Mirror tenant headers onto the response as well so they're accessible to
  // client-side code that inspects response headers (e.g. edge middleware tests).
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
