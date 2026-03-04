import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("redirects unauthenticated users from /dashboard to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login with valid credentials redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("e2e-coach@lista.test");
    await page.getByLabel("Password").fill("Test1234!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("e2e-coach@lista.test");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
  });

  test("authenticated users visiting /login are redirected to /dashboard", async ({ page, context }) => {
    // Log in first
    await page.goto("/login");
    await page.getByLabel("Email").fill("e2e-coach@lista.test");
    await page.getByLabel("Password").fill("Test1234!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Now try visiting login again
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
