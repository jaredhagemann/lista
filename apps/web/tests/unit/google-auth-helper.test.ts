/**
 * Unit tests for the shared `signInWithGoogle` helper.
 *
 * Pins the contract laid out in `IMPLEMENTATION_PLAN.md` — "Add shared
 * signInWithGoogle client helper":
 *
 *   (a) the call is made with the expected `provider`/`options`
 *   (b) `redirectTo` is the current origin's `/auth/callback`
 *   (c) a malicious `next` like `//evil.com` or `https://evil.com` is
 *       rejected/stripped
 *   (d) a benign `next` like `/invite/abc` is preserved
 *
 * The `?next=` value is also re-validated server-side in
 * `/auth/callback/route.ts` (covered by a separate plan item) — this helper
 * is the client-side first line of defence so we never even *attempt* an
 * OAuth round-trip with a poisoned next.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignInWithOAuth = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  })),
}));

import { signInWithGoogle, sanitizeNext } from "@/lib/auth/google";

describe("sanitizeNext", () => {
  it("returns /dashboard when next is null, undefined, or empty", () => {
    expect(sanitizeNext(null)).toBe("/dashboard");
    expect(sanitizeNext(undefined)).toBe("/dashboard");
    expect(sanitizeNext("")).toBe("/dashboard");
  });

  it("preserves a benign same-origin path", () => {
    expect(sanitizeNext("/invite/abc")).toBe("/invite/abc");
    expect(sanitizeNext("/dashboard/teams/123?tab=roster")).toBe(
      "/dashboard/teams/123?tab=roster"
    );
  });

  it("rejects protocol-relative `//evil.com`", () => {
    expect(sanitizeNext("//evil.com")).toBe("/dashboard");
    expect(sanitizeNext("//evil.com/path")).toBe("/dashboard");
  });

  it("rejects backslash-escaped `/\\evil.com` (some browsers normalise `\\` to `/`)", () => {
    expect(sanitizeNext("/\\evil.com")).toBe("/dashboard");
  });

  it("rejects absolute URLs and pseudo-schemes", () => {
    expect(sanitizeNext("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNext("http://evil.com/x")).toBe("/dashboard");
    expect(sanitizeNext("javascript:alert(1)")).toBe("/dashboard");
    expect(sanitizeNext("data:text/html,foo")).toBe("/dashboard");
  });

  it("rejects values that do not start with `/`", () => {
    expect(sanitizeNext("dashboard")).toBe("/dashboard");
    expect(sanitizeNext(" /dashboard")).toBe("/dashboard");
  });
});

describe("signInWithGoogle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: "https://accounts.google.com/o/oauth2/..." },
      error: null,
    });
  });

  it("(a) calls signInWithOAuth with provider=google and the expected queryParams", async () => {
    await signInWithGoogle();

    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    expect(arg.provider).toBe("google");
    expect(arg.options).toBeDefined();
    expect(arg.options.queryParams).toEqual({
      access_type: "offline",
      prompt: "select_account",
    });
  });

  it("(b) redirectTo points at the current origin's /auth/callback", async () => {
    await signInWithGoogle();
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/auth/callback");
  });

  it("(d) a benign next like `/invite/abc` is preserved on redirectTo", async () => {
    await signInWithGoogle("/invite/abc-123");
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    expect(url.searchParams.get("next")).toBe("/invite/abc-123");
  });

  it("(d) preserves a next with its own query string", async () => {
    await signInWithGoogle("/invite/abc?token=xyz");
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    // `next` value retains its query string after decoding
    expect(url.searchParams.get("next")).toBe("/invite/abc?token=xyz");
  });

  it("(c) a malicious protocol-relative next `//evil.com` falls back to /dashboard", async () => {
    await signInWithGoogle("//evil.com");
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("(c) an absolute URL next `https://evil.com` falls back to /dashboard", async () => {
    await signInWithGoogle("https://evil.com");
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("defaults next to /dashboard when omitted", async () => {
    await signInWithGoogle();
    const [arg] = mockSignInWithOAuth.mock.calls[0];
    const url = new URL(arg.options.redirectTo);
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("returns the underlying Supabase result so callers can render error state", async () => {
    const fakeError = { name: "AuthError", message: "provider misconfigured" };
    mockSignInWithOAuth.mockResolvedValueOnce({ data: null, error: fakeError });
    const result = await signInWithGoogle();
    expect(result.error).toEqual(fakeError);
  });
});
