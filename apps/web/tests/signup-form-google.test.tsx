/**
 * Component-level tests for the "Continue with Google" button on the
 * root SignupForm.
 *
 * Plan reference: IMPLEMENTATION_PLAN.md → "Add 'Continue with Google' to
 * root signup form".
 *
 * The contract we're pinning:
 *
 *   - The button renders with the same stable `data-testid="google-auth-button"`
 *     used by `LoginForm`, so the planned e2e spec can target both screens
 *     with one selector.
 *   - Clicking the button calls the shared `signInWithGoogle()` helper with
 *     `next = /invite/${inviteId}` when a `?invite=...` query param is
 *     present (R6 — the invite must survive the OAuth round-trip), and
 *     `next = /dashboard` otherwise (R2 — the same Google call handles both
 *     first-time signup and subsequent sign-in).
 *   - Loading state: clicking shows "Redirecting…" and disables both auth
 *     paths so the user can't fire off `/api/auth/signup` mid-redirect.
 *   - Error state: helper resolved-error and thrown-error branches both
 *     surface in the existing destructive banner, and the Google button
 *     re-enables for retry.
 *   - The pre-existing email/password submit path is *not* regressed —
 *     still POSTs to `/api/auth/signup` with the typed fields and threads
 *     `inviteId` through, and the success-screen swap still happens.
 *
 * The shared helper itself (origin-derived `redirectTo`, `next`
 * sanitisation) is pinned by `tests/unit/google-auth-helper.test.ts`; this
 * file only verifies SignupForm's wiring of it.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const searchParamsStore = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsStore.get(key) ?? null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
}));

const mockSignInWithGoogle = vi.fn();
vi.mock("@/lib/auth/google", () => ({
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
}));

import { SignupForm } from "@/app/(auth)/signup/signup-form";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsStore.clear();
  mockSignInWithGoogle.mockResolvedValue({
    data: { provider: "google" },
    error: null,
  });
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  // The form posts to `/api/auth/signup`; we only care that it's still
  // called with the typed fields in the regression test.
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  // Don't leak the fetch stub across files.
  // @ts-expect-error — we own this slot for the test process.
  delete globalThis.fetch;
});

// ── Render / wiring ──────────────────────────────────────────────────────────

describe("SignupForm — Continue with Google button", () => {
  it("renders a Google button with the same stable data-testid the LoginForm uses", () => {
    render(<SignupForm />);
    const btn = screen.getByTestId("google-auth-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/continue with google/i);
  });

  it("renders the button regardless of branding props (white-label tenants)", () => {
    render(<SignupForm appName="Joga FC" logoUrl="/logos/joga.png" />);
    // Branding lives in the Card header; the OAuth button's label is
    // auth-method-specific by design — same as LoginForm.
    expect(screen.getByTestId("google-auth-button").textContent).toMatch(
      /continue with google/i,
    );
  });

  it("clicking the button calls signInWithGoogle with /dashboard when no ?invite= is present", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(mockSignInWithGoogle).toHaveBeenCalledWith("/dashboard");
  });

  it("forwards ?invite=:id as next=/invite/:id so the invite survives the OAuth round-trip (R6)", async () => {
    // Mirrors a user landing on `/signup?invite=abc-123` after clicking an
    // invite link. The OAuth round-trip lands them back on
    // `/auth/callback?next=/invite/abc-123`, which the callback route
    // sanitises and redirects to.
    searchParamsStore.set("invite", "abc-123");
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(mockSignInWithGoogle).toHaveBeenCalledWith("/invite/abc-123");
  });
});

// ── Loading + error state ────────────────────────────────────────────────────

describe("SignupForm — Google button states", () => {
  it("disables both auth paths while the Google redirect is in flight", async () => {
    // The helper never resolves — we want to inspect the in-flight state.
    mockSignInWithGoogle.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<SignupForm />);

    const googleBtn = screen.getByTestId("google-auth-button") as HTMLButtonElement;
    await user.click(googleBtn);

    await waitFor(() => {
      expect(googleBtn.textContent).toMatch(/redirecting/i);
      expect(googleBtn.disabled).toBe(true);
    });

    // Email/password submit is also disabled — prevents the user kicking
    // off `/api/auth/signup` while we're already navigating to Google.
    const submitBtn = screen.getByRole("button", {
      name: /^create account$/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("shows the error returned by the helper and re-enables the button", async () => {
    mockSignInWithGoogle.mockResolvedValue({
      data: null,
      error: { message: "provider misconfigured" },
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    await waitFor(() => {
      expect(screen.getByText(/provider misconfigured/i)).toBeTruthy();
    });

    const googleBtn = screen.getByTestId("google-auth-button") as HTMLButtonElement;
    expect(googleBtn.disabled).toBe(false);
    expect(googleBtn.textContent).toMatch(/continue with google/i);
  });

  it("catches a thrown helper error and surfaces a friendly fallback", async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error("Network down"));
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
  });
});

// ── Email/password regression ─────────────────────────────────────────────────

describe("SignupForm — email/password path still works after the Google addition", () => {
  it("submitting the form still POSTs to /api/auth/signup with the typed credentials", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/first name/i), "Jane");
    await user.type(screen.getByLabelText(/last name/i), "Smith");
    await user.type(screen.getByLabelText(/email/i), "jane@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/auth/signup");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      email: "jane@example.com",
      password: "supersecret",
      firstName: "Jane",
      lastName: "Smith",
      inviteId: null,
    });
    // The Google helper must NOT be called as a side-effect of the
    // email/password submit — verifies the two paths are independent.
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });

  it("threads the ?invite= query param into the /api/auth/signup body (existing behaviour)", async () => {
    // Pinned alongside the Google path's R6 wiring so we catch a future
    // refactor that accidentally drops inviteId from one path or the other.
    searchParamsStore.set("invite", "abc-123");
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/first name/i), "Jane");
    await user.type(screen.getByLabelText(/email/i), "jane@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      inviteId: "abc-123",
    });
  });

  it("on successful signup, swaps the form for the 'check your email' confirmation screen", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/first name/i), "Jane");
    await user.type(screen.getByLabelText(/email/i), "jane@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeTruthy();
    });
    expect(screen.getByText(/jane@example\.com/)).toBeTruthy();
  });
});
