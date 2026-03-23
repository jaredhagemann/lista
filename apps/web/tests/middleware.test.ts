import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// Import after mocking
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";
import { config as middlewareConfig } from "@/middleware";

const mockGetUser = vi.fn();

beforeEach(() => {
  vi.mocked(createServerClient).mockReturnValue({
    auth: { getUser: mockGetUser },
  } as ReturnType<typeof createServerClient>);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

function req(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3001${pathname}`));
}

function locationOf(response: Response): string | null {
  return response.headers.get("location");
}

describe("updateSession — routing logic", () => {
  it("passes through known public route /login when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/login"));
    expect(locationOf(response)).toBeNull();
  });

  it("redirects unauthenticated request on protected route to /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/dashboard"));
    expect(locationOf(response)).toContain("/login");
  });

  it("passes through /api/invite/ when unauthenticated (Bug 2 fix)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/api/invite/some-uuid"));
    expect(locationOf(response)).toBeNull();
  });

  it("passes through /api/managed-profiles when unauthenticated (Bug 2 fix)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/api/managed-profiles"));
    expect(locationOf(response)).toBeNull();
  });

  it("redirects authenticated user on /login to /dashboard", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123", email: "user@example.com" } } });
    const response = await updateSession(req("/login"));
    expect(locationOf(response)).toContain("/dashboard");
  });
});

describe("middleware matcher — PWA asset exclusion (Bug 3 fix)", () => {
  // The middleware.ts matcher pattern controls which paths reach updateSession.
  // Paths excluded by the pattern are served directly, bypassing middleware.
  // Derive the RegExp from the real exported config so this test stays in sync
  // with src/middleware.ts automatically.
  const matcherPattern = new RegExp(middlewareConfig.matcher[0]);

  it("excludes /manifest.json so logged-out users receive the file, not a redirect", () => {
    expect(matcherPattern.test("/manifest.json")).toBe(false);
  });

  it("excludes /sw.js so logged-out users receive the file, not a redirect", () => {
    expect(matcherPattern.test("/sw.js")).toBe(false);
  });

  it("excludes /favicon.ico from middleware", () => {
    expect(matcherPattern.test("/favicon.ico")).toBe(false);
  });

  it("includes /dashboard so protected routes are still enforced", () => {
    expect(matcherPattern.test("/dashboard")).toBe(true);
  });

  it("includes /api/invite/some-id so that route reaches its handler", () => {
    expect(matcherPattern.test("/api/invite/some-id")).toBe(true);
  });
});
