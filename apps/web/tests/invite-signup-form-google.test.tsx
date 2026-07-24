/**
 * Component-level tests for the "Continue with Google" button on the
 * invite-flow signup form.
 *
 * Plan reference: IMPLEMENTATION_PLAN.md → "Add 'Continue with Google' to
 * invite signup + login forms".
 *
 * The contract we're pinning:
 *
 *   - The button renders with the same stable `data-testid="google-auth-button"`
 *     used by `LoginForm`/`SignupForm`/`InviteLoginForm`, so the planned
 *     e2e spec can target all four auth surfaces with one selector.
 *   - `next` is *always* `/invite/${inviteId}` — the invite must survive
 *     the OAuth round-trip (R6). The invite id comes from the route
 *     segment, so there's no `?invite=` or `?next=` query param to honour.
 *   - "Continue with Google" sits *alongside* the existing password form;
 *     it does not replace it (per the plan: "Excludes the OAuth-vs-password
 *     choice UX redesign — keep both visible").
 *   - Loading state: clicking shows "Redirecting…" and disables both auth
 *     paths so the user can't fire `/api/auth/invite-signup` mid-redirect.
 *   - Error state: helper resolved-error and thrown-error branches both
 *     surface in the existing destructive banner, and the Google button
 *     re-enables for retry.
 *   - The pre-existing email/password submit path is *not* regressed —
 *     still POSTs to `/api/auth/invite-signup` with the typed fields and
 *     pushes to `/invite/:id` after the follow-up `signInWithPassword`.
 *
 * The shared helper itself (origin-derived `redirectTo`, `next`
 * sanitisation) is pinned by `tests/unit/google-auth-helper.test.ts`; this
 * file only verifies that `InviteSignupForm` wires the helper up correctly.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { InviteSignupForm } from "@/components/invite/invite-signup-form";

const INVITE_ID = "inv-abc-123";
const INVITE_EMAIL = "invitee@example.com";
const PREFILLED_FIRST = "Jane";
const PREFILLED_LAST = "Smith";

function renderForm(
  overrides: Partial<React.ComponentProps<typeof InviteSignupForm>> = {},
) {
  return render(
    <InviteSignupForm
      inviteId={INVITE_ID}
      email={INVITE_EMAIL}
      firstName={PREFILLED_FIRST}
      lastName={PREFILLED_LAST}
      {...overrides}
    />,
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithGoogle.mockResolvedValue({
    data: { provider: "google" },
    error: null,
  });
  mockSignInWithPassword.mockResolvedValue({ error: null });
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  // The form posts to `/api/auth/invite-signup`; the regression test
  // inspects mock.calls[0] to confirm the typed fields still flow through.
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  // Don't leak the fetch stub across files.
  // @ts-expect-error — we own this slot for the test process.
  delete globalThis.fetch;
});

// ── Render / wiring ──────────────────────────────────────────────────────────

describe("InviteSignupForm — Continue with Google button", () => {
  it("renders a Google button with the stable data-testid for e2e", () => {
    renderForm();
    const btn = screen.getByTestId("google-auth-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/continue with google/i);
  });

  it("renders alongside the existing password form (both auth paths visible)", () => {
    // The plan explicitly excludes the "OAuth-vs-password choice UX
    // redesign" — we want both paths visible so the user picks. Confirm
    // the password submit button is still present when the Google button
    // is rendered.
    renderForm();
    expect(screen.getByTestId("google-auth-button")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^create account$/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
  });

  it("renders the button regardless of branding props (white-label tenants)", () => {
    renderForm({ brandName: "Joga FC", logoUrl: "/logos/joga.png" });
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

describe("InviteSignupForm — Google button states", () => {
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
    // off `/api/auth/invite-signup` while we're already navigating to Google.
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

describe("InviteSignupForm — email/password path still works after the Google addition", () => {
  it("submitting the form still POSTs to /api/auth/invite-signup with the typed credentials", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/auth/invite-signup");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      email: INVITE_EMAIL,
      password: "supersecret",
      firstName: PREFILLED_FIRST,
      lastName: PREFILLED_LAST,
    });
    // The Google helper must NOT be called as a side-effect of the
    // email/password submit — verifies the two paths are independent.
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });

  it("on successful invite-signup, runs the follow-up signInWithPassword and pushes to /invite/:id", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: INVITE_EMAIL,
        password: "supersecret",
      });
      expect(mockPush).toHaveBeenCalledWith(`/invite/${INVITE_ID}`);
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
