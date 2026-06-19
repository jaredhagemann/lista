/**
 * Unit tests for the server-side `?next=` sanitiser used by `/auth/callback`
 * and `/auth/confirm`.
 *
 * Belt-and-suspenders for the open-redirect surface. Supabase already
 * enforces a redirect-URI allow-list (spec R3), but the `next` param is what
 * we concatenate onto our own origin after `exchangeCodeForSession` — so a
 * value like `//evil.com` would still produce `https://lista.team//evil.com`
 * which most clients normalise to `https://evil.com`. The plan item
 * "Sanitise `next` in `/auth/callback`" requires the same check live
 * server-side as well as in the client-side `signInWithGoogle` helper.
 *
 * The tests run against the actual route handlers (not just the sanitiser
 * function) so a future regression that drops the call is caught.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        verifyOtp: mockVerifyOtp,
      },
    })
  ),
}));

import { sanitizeNext, DEFAULT_NEXT } from "@/lib/auth/sanitize-next";
import { GET as callbackGet } from "@/app/auth/callback/route";
import { GET as confirmGet } from "@/app/auth/confirm/route";

const ORIGIN = "https://lista.team";

function makeCallback(next: string | null, code = "valid-code"): Request {
  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (next !== null) params.set("next", next);
  return new Request(`${ORIGIN}/auth/callback?${params.toString()}`);
}

function makeConfirm(
  next: string | null,
  opts: { code?: string; token_hash?: string; type?: string } = {}
): Request {
  const params = new URLSearchParams();
  if (opts.code) params.set("code", opts.code);
  if (opts.token_hash) params.set("token_hash", opts.token_hash);
  if (opts.type) params.set("type", opts.type);
  if (next !== null) params.set("next", next);
  return new Request(`${ORIGIN}/auth/confirm?${params.toString()}`);
}

// ── sanitizeNext (pure function) ─────────────────────────────────────────────

describe("sanitizeNext", () => {
  it("falls back to /dashboard when next is null, undefined, or empty", () => {
    expect(sanitizeNext(null)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("")).toBe(DEFAULT_NEXT);
  });

  it("preserves allowed same-origin paths", () => {
    expect(sanitizeNext("/dashboard")).toBe("/dashboard");
    expect(sanitizeNext("/invite/abc")).toBe("/invite/abc");
    expect(sanitizeNext("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it("rejects protocol-relative `//evil.com`", () => {
    expect(sanitizeNext("//evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("//evil.com/foo")).toBe(DEFAULT_NEXT);
  });

  it("rejects backslash-escaped `/\\evil.com`", () => {
    expect(sanitizeNext("/\\evil.com")).toBe(DEFAULT_NEXT);
  });

  it("rejects absolute URLs and pseudo-schemes", () => {
    expect(sanitizeNext("https://evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("http://evil.com/x")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("javascript:alert(1)")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("data:text/html,foo")).toBe(DEFAULT_NEXT);
  });

  it("rejects values that do not start with `/`", () => {
    expect(sanitizeNext("dashboard")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(" /dashboard")).toBe(DEFAULT_NEXT);
  });
});

// ── /auth/callback route ─────────────────────────────────────────────────────

describe("/auth/callback route — next sanitisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("redirects to {origin}{next} on successful code exchange with a benign next", async () => {
    const response = await callbackGet(makeCallback("/invite/abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/abc`);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("valid-code");
  });

  it("preserves a next that carries its own query string", async () => {
    const response = await callbackGet(makeCallback("/invite/abc?token=xyz"));
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/invite/abc?token=xyz`
    );
  });

  it("falls back to /dashboard when next is omitted", async () => {
    const response = await callbackGet(makeCallback(null));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects protocol-relative `//evil.com` and falls back to /dashboard", async () => {
    const response = await callbackGet(makeCallback("//evil.com"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects absolute `https://evil.com` and falls back to /dashboard", async () => {
    const response = await callbackGet(makeCallback("https://evil.com"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects `/\\evil.com` and falls back to /dashboard", async () => {
    const response = await callbackGet(makeCallback("/\\evil.com"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects `javascript:alert(1)` and falls back to /dashboard", async () => {
    const response = await callbackGet(makeCallback("javascript:alert(1)"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("redirects to /login?error=auth when exchangeCodeForSession errors", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "bad code" },
    });
    const response = await callbackGet(makeCallback("/invite/abc"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth`);
  });

  it("redirects to /login?error=auth when no code is present, even with a poisoned next", async () => {
    const params = new URLSearchParams();
    params.set("next", "//evil.com");
    const request = new Request(`${ORIGIN}/auth/callback?${params.toString()}`);
    const response = await callbackGet(request);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth`);
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });
});

// ── /auth/confirm route ──────────────────────────────────────────────────────

describe("/auth/confirm route — next sanitisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("redirects to {origin}{next} after a successful verifyOtp", async () => {
    const response = await confirmGet(
      makeConfirm("/invite/abc", { token_hash: "hash-xyz", type: "signup" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/abc`);
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "hash-xyz",
    });
  });

  it("redirects to {origin}{next} after a successful exchangeCodeForSession", async () => {
    const response = await confirmGet(
      makeConfirm("/invite/abc", { code: "valid-code" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/invite/abc`);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("valid-code");
  });

  it("rejects protocol-relative `//evil.com` on the verifyOtp branch", async () => {
    const response = await confirmGet(
      makeConfirm("//evil.com", { token_hash: "hash-xyz", type: "signup" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects absolute `https://evil.com` on the code-exchange branch", async () => {
    const response = await confirmGet(
      makeConfirm("https://evil.com", { code: "valid-code" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("redirects to /login?error=auth when verifyOtp errors", async () => {
    mockVerifyOtp.mockResolvedValueOnce({ error: { message: "expired" } });
    const response = await confirmGet(
      makeConfirm("/invite/abc", { token_hash: "hash-xyz", type: "signup" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth`);
  });

  it("redirects to /login?error=auth when exchangeCodeForSession errors", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "bad code" },
    });
    const response = await confirmGet(
      makeConfirm("/invite/abc", { code: "bad-code" })
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth`);
  });

  it("redirects to /login?error=auth when neither code nor token_hash is present", async () => {
    const response = await confirmGet(makeConfirm("/invite/abc"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth`);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
