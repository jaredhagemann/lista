/**
 * Integration tests for src/lib/supabase/middleware.ts (updateSession)
 *
 * Strategy:
 *   - Uses the REAL updateSession() against the real local Supabase stack.
 *   - All requests target a public route (/invite/test) so auth.getUser() returning
 *     null does NOT trigger the login redirect — the response is the supabaseResponse
 *     that was created with NextResponse.next({ request: { headers } }).
 *   - Verifies header forwarding via the x-middleware-request-{name} encoding that
 *     Next.js writes onto the response when NextResponse.next() receives custom
 *     request headers. This is the exact mechanism by which tenant headers reach
 *     Server Components — so if updateSession() ever stops forwarding them through
 *     its internal NextResponse.next() calls, these tests will fail.
 *
 * Requires: `supabase start`
 * Run via: pnpm test:integration
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
// Triggers dotenv.config({ path: ".env.test.local" }) as a side effect,
// providing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
import "../rls/helpers";

import { updateSession } from "@/lib/supabase/middleware";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A public route that updateSession() never redirects regardless of auth state,
 * so we always get back the supabaseResponse (not a redirect Response).
 */
const PUBLIC_PATH = "/invite/test";

function makeRequest(path = PUBLIC_PATH) {
  return new NextRequest(`http://lista.team${path}`, {
    headers: { host: "lista.team" },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("updateSession — requestHeaders forwarding", () => {
  it("encodes custom requestHeaders as x-middleware-request-* on the response", async () => {
    const request = makeRequest();
    const customHeaders = new Headers(request.headers);
    customHeaders.set("x-tenant-id", "org-abc");
    customHeaders.set("x-tenant-plan", "club");
    customHeaders.set("x-tenant-is-white-label", "true");

    const response = await updateSession(request, customHeaders);

    // Next.js writes every header passed to NextResponse.next({ request: { headers } })
    // onto the response as x-middleware-request-{name}. The Node.js server then
    // reads these back and injects them into the downstream request so Server
    // Components can access them via headers().
    expect(response.headers.get("x-middleware-request-x-tenant-id")).toBe("org-abc");
    expect(response.headers.get("x-middleware-request-x-tenant-plan")).toBe("club");
    expect(response.headers.get("x-middleware-request-x-tenant-is-white-label")).toBe("true");
  });

  it("does not include x-tenant-* when requestHeaders are omitted", async () => {
    const request = makeRequest();

    const response = await updateSession(request);

    // The original request has no tenant headers, so none should appear.
    expect(response.headers.get("x-middleware-request-x-tenant-id")).toBeFalsy();
    expect(response.headers.get("x-middleware-request-x-tenant-plan")).toBeFalsy();
  });

  it("does not redirect public routes regardless of auth state", async () => {
    const request = makeRequest(PUBLIC_PATH);

    const response = await updateSession(request);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
  });

  it("encodes all optional tenant headers when present", async () => {
    const request = makeRequest();
    const customHeaders = new Headers(request.headers);
    customHeaders.set("x-tenant-id", "org-xyz");
    customHeaders.set("x-tenant-slug", "jogafc");
    customHeaders.set("x-tenant-brand-color", "#ff0000");
    customHeaders.set("x-tenant-logo-url", "https://cdn.example.com/logo.png");
    customHeaders.set("x-tenant-org-name", "Joga FC");
    customHeaders.set("x-tenant-subdomain", "jogafc");

    const response = await updateSession(request, customHeaders);

    expect(response.headers.get("x-middleware-request-x-tenant-slug")).toBe("jogafc");
    expect(response.headers.get("x-middleware-request-x-tenant-brand-color")).toBe("#ff0000");
    expect(response.headers.get("x-middleware-request-x-tenant-logo-url")).toBe("https://cdn.example.com/logo.png");
    expect(response.headers.get("x-middleware-request-x-tenant-org-name")).toBe("Joga FC");
    expect(response.headers.get("x-middleware-request-x-tenant-subdomain")).toBe("jogafc");
  });
});
