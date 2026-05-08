import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session and handles auth redirects.
 *
 * @param requestHeaders - Pre-built headers to forward to the downstream
 *   request (e.g. x-tenant-* injected by middleware). When provided, these
 *   replace the raw request headers in both NextResponse.next() calls so that
 *   Server Components can read them via headers(). If omitted, the original
 *   request headers are forwarded unchanged.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers
) {
  const forwardedHeaders = requestHeaders ?? new Headers(request.headers);

  let supabaseResponse = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: forwardedHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Scope to .lista.team only when subdomain routing is active.
              // Vercel sets NODE_ENV=production on all deployments (including staging),
              // so NODE_ENV alone is not a reliable signal — SUBDOMAIN_ROUTING_ENABLED
              // is the explicit opt-in that distinguishes production from staging.
              domain:
                process.env.SUBDOMAIN_ROUTING_ENABLED !== "false" &&
                process.env.NODE_ENV === "production"
                  ? ".lista.team"
                  : undefined,
            })
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login (except for public routes)
  const publicRoutes = ["/login", "/signup", "/forgot-password", "/invite", "/auth/callback", "/auth/confirm", "/api/auth/", "/api/invite/", "/api/invitations", "/api/managed-profiles", "/api/account/", "/api/teams", "/privacy", "/support"];
  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  if (!user && !isPublicRoute && request.nextUrl.pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
