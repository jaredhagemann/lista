/**
 * Component-level tests for the "Continue with Google" button on the
 * invite-flow login form.
 *
 * Plan reference: IMPLEMENTATION_PLAN.md → "Add 'Continue with Google' to
 * invite signup + login forms".
 *
 * The contract we're pinning:
 *
 *   - The button renders with the same stable `data-testid="google-auth-button"`
 *     used by `LoginForm`/`SignupForm`, so the planned e2e spec can target
 *     all four auth surfaces with one selector.
 *   - `next` is *always* `/invite/${inviteId}` — the invite must survive the
 *     OAuth round-trip (R6). Unlike the root login form, there is no
 *     `?next=` query param to honour here; the invite id comes from the
 *     route segment and is the only valid post-auth landing path.
 *   - Loading state: clicking shows "Redirecting…" and disables both auth
 *     paths so the user can't fire `signInWithPassword` mid-redirect.
 *   - Error state: helper resolved-error and thrown-error branches both
 *     surface in the existing destructive banner, and the Google button
 *     re-enables for retry.
 *   - The pre-existing email/password submit path is *not* regressed —
 *     still calls `signInWithPassword` with the typed credentials and
 *     pushes to `/invite/:id` on success.
 *
 * The shared helper itself (origin-derived `redirectTo`, `next`
 * sanitisation) is pinned by `tests/unit/google-auth-helper.test.ts`; this
 * file only verifies that `InviteLoginForm` wires the helper up correctly.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
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

import { InviteLoginForm } from "@/components/invite/invite-login-form";

const INVITE_ID = "inv-abc-123";
const INVITE_EMAIL = "invitee@example.com";

function renderForm(
  overrides: Partial<React.ComponentProps<typeof InviteLoginForm>> = {},
) {
  return render(
    <InviteLoginForm
      inviteId={INVITE_ID}
      email={INVITE_EMAIL}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithGoogle.mockResolvedValue({
    data: { provider: "google" },
    error: null,
  });
  mockSignInWithPassword.mockResolvedValue({ error: null });
});

// ── Render / wiring ──────────────────────────────────────────────────────────

describe("InviteLoginForm — Continue with Google button", () => {
  it("renders a Google button with the stable data-testid for e2e", () => {
    renderForm();
    const btn = screen.getByTestId("google-auth-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/continue with google/i);
  });

  it("renders the button regardless of branding props (white-label tenants)", () => {
    renderForm({ brandName: "Joga FC", logoUrl: "/logos/joga.png" });
    // The button label stays auth-method-specific; tenant branding lives in
    // the Card header. Mirrors the LoginForm/SignupForm convention.
    expect(screen.getByTestId("google-auth-button").textContent).toMatch(
      /continue with google/i,
    );
  });

  it("clicking the button calls signInWithGoogle with /invite/:id (R6)", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByTestId("google-auth-button"));

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(mockSignInWithGoogle).toHaveBeenCalledWith(`/invite/${INVITE_ID}`);
  });
});

// ── Loading + error state ────────────────────────────────────────────────────

describe("InviteLoginForm — Google button states", () => {
  it("disables both auth paths while the Google redirect is in flight", async () => {
    // The helper never resolves — we want to inspect the in-flight state.
    mockSignInWithGoogle.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderForm();

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
    renderForm();

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
    renderForm();

    await user.click(screen.getByTestId("google-auth-button"));

    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
  });
});

// ── Email/password regression ─────────────────────────────────────────────────

describe("InviteLoginForm — email/password path still works after the Google addition", () => {
  it("submitting the form still calls signInWithPassword with the invite email + typed password", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: INVITE_EMAIL,
      password: "supersecret",
    });
    // The Google helper must NOT be called as a side-effect of the
    // email/password submit — verifies the two paths are independent.
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });

  it("on successful password sign-in, pushes to /invite/:id (existing behaviour)", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/invite/${INVITE_ID}`);
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
