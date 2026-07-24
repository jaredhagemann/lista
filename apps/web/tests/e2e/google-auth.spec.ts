/**
 * E2E smoke for "Continue with Google" rendering on the public auth surfaces.
 *
 * Per `docs/specs/google-auth.md` (Test Plan) and `IMPLEMENTATION_PLAN.md`:
 *   - Does NOT perform a live OAuth round-trip. Google sign-in itself is
 *     stubbed/mocked in CI — clicking the button would navigate to Supabase
 *     `/auth/v1/authorize`, which in turn redirects to Google. We don't go
 *     there. Instead we pin the load-bearing UI contract: the button renders,
 *     is enabled, and carries the expected affordance text on both `/login`
 *     and `/signup`.
 *   - The `data-testid="google-auth-button"` selector is the spec's
 *     single-source-of-truth across `LoginForm`, `SignupForm`,
 *     `InviteLoginForm`, and `InviteSignupForm` — keep it stable here so a
 *     refactor that drops the testid fails this spec rather than silently
 *     breaking the planned analytics/e2e hooks.
 */

import { test, expect } from "@playwright/test";

test.describe("Continue with Google button", () => {
  test("renders on /login (default next=/dashboard)", async ({ page }) => {
    await page.goto("/login");

    const button = page.getByTestId("google-auth-button");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Continue with Google");
  });

  test("renders on /signup (default — no invite)", async ({ page }) => {
    await page.goto("/signup");

    const button = page.getByTestId("google-auth-button");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Continue with Google");
  });

  // R6 — the invite affordance must survive the OAuth round-trip. The button
  // is identical (same testid, same label), but the underlying `next` param
  // changes. We can't assert the redirect target without clicking, but we can
  // pin that the button renders when arriving via the invite-carrying URL —
  // a regression that hides the button only when `?next=` / `?invite=` is
  // present (e.g. a SSR guard misfire) would surface here.
  test("renders on /login?next=/invite/:id", async ({ page }) => {
    await page.goto("/login?next=/invite/abc");

    const button = page.getByTestId("google-auth-button");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  });

  test("renders on /signup?invite=:id", async ({ page }) => {
    await page.goto("/signup?invite=abc");

    const button = page.getByTestId("google-auth-button");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  });
});
