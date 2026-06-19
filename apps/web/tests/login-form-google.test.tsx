/**
 * Component-level tests for the "Continue with Google" button on the
 * root LoginForm.
 *
 * Plan reference: IMPLEMENTATION_PLAN.md → "Add 'Continue with Google' to
 * root login form".
 *
 * The contract we're pinning:
 *
 *   - The button renders with a stable `data-testid="google-auth-button"`
 *     so the planned e2e spec can target it without prose-coupled selectors.
 *   - Clicking the button calls the shared `signInWithGoogle()` helper with
 *     `next` derived from `useSearchParams().get('next') ?? '/dashboard'` —
 *     i.e. a user who lands on `/login?next=/invite/abc` is returned to
 *     `/invite/abc` after the OAuth round-trip (spec R6).
 *   - Loading state: clicking shows "Redirecting…" and disables both auth
 *     paths (Google + email/password) so the user can't double-submit
 *     while the browser is navigating to Google.
 *   - Error state: if the helper resolves with `{ error }` we render it in
 *     the same destructive banner the email/password path uses, and we
 *     reset the Google button so the user can retry. (Resolves the
 *     "user cancels at Google, helper throws" branch the plan calls out.)
 *   - The pre-existing email/password submit path is *not* regressed by
 *     the new button — same handler, same fields, same success behaviour.
 *
 * The shared `signInWithGoogle` helper itself (origin-derived redirectTo,
 * `next` sanitisation, malicious-URL guards) is already pinned by
 * `tests/unit/google-auth-helper.test.ts`; this file deliberately does not
 * re-test those properties — it only verifies that the LoginForm wires the
 * helper up correctly.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();

const searchParamsStore = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
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

const mockSignInWithPassword = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
    },
  }),
}));

import { LoginForm } from "@/app/(auth)/login/login-form";

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsStore.clear();
  mockSignInWithGoogle.mockResolvedValue({ data: { provider: "google" }, error: null });
  mockSignInWithPassword.mockResolvedValue({ error: null });
});

// ── Render / wiring ──────────────────────────────────────────────────────────

describe("LoginForm — Continue with Google button", () => {
  it("renders a Google button with the stable data-testid for e2e", () => {
    render(<LoginForm />);
    const btn = screen.getByTestId("google-auth-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/continue with google/i);
  });

  it("renders the button regardless of branding props (white-label tenants)", () => {
    render(<LoginForm appName="Joga FC" logoUrl="/logos/joga.png" />);
    // The button text is auth-method-specific ("Continue with Google"), not
    // tenant-branded — that's intentional. Branding lives in the Card header.
    expect(screen.getByTestId("google-auth-button").textContent).toMatch(
      /continue with google/i,
    );
  });

  it("clicking the button calls signInWithGoogle with /dashboard when no ?next= is present", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(mockSignInWithGoogle).toHaveBeenCalledWith("/dashboard");
  });

  it("clicking the button forwards the ?next= search param to the helper (R6 invite flow)", async () => {
    // Simulates a user who landed on `/login?next=/invite/abc-123` —
    // either by following an invite-protected link while logged out, or
    // because they were redirected to login mid-flow. The OAuth round-trip
    // must return them to the original `next` path.
    searchParamsStore.set("next", "/invite/abc-123");
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    expect(mockSignInWithGoogle).toHaveBeenCalledWith("/invite/abc-123");
  });
});

// ── Loading + error state ────────────────────────────────────────────────────

describe("LoginForm — Google button states", () => {
  it("disables both auth paths while the Google redirect is in flight", async () => {
    // The helper never resolves — we want to inspect the in-flight state.
    mockSignInWithGoogle.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<LoginForm />);

    const googleBtn = screen.getByTestId("google-auth-button") as HTMLButtonElement;
    await user.click(googleBtn);

    await waitFor(() => {
      expect(googleBtn.textContent).toMatch(/redirecting/i);
      expect(googleBtn.disabled).toBe(true);
    });

    // Email/password submit is also disabled — prevents the user kicking
    // off a parallel password sign-in while we're already redirecting.
    const submitBtn = screen.getByRole("button", { name: /^sign in$/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("shows the error returned by the helper and re-enables the button", async () => {
    mockSignInWithGoogle.mockResolvedValue({
      data: null,
      error: { message: "provider misconfigured" },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

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
    render(<LoginForm />);

    await user.click(screen.getByTestId("google-auth-button"));

    await waitFor(() => {
      // Error.message is surfaced verbatim — same convention as the
      // existing email/password error banner.
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
  });
});

// ── Email/password regression ─────────────────────────────────────────────────

describe("LoginForm — email/password path still works after the Google addition", () => {
  it("submitting the form still calls signInWithPassword with the typed credentials", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "supersecret",
    });
    // The Google helper must NOT be called as a side-effect of the
    // email/password submit — verifies the two paths are independent.
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });

  it("on successful password sign-in, redirects to /dashboard (existing behaviour)", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
