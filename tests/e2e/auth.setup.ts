import { test as setup } from "@playwright/test";
import path from "path";

const BASE_URL = "http://localhost:3001";

export const COACH_AUTH_FILE = path.join(__dirname, ".auth/coach.json");
export const PLAYER_AUTH_FILE = path.join(__dirname, ".auth/player.json");
export const INVITEE_AUTH_FILE = path.join(__dirname, ".auth/invitee.json");

setup("authenticate as coach", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill("e2e-coach@lista.test");
  await page.getByLabel("Password").fill("Test1234!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.context().storageState({ path: COACH_AUTH_FILE });
});

setup("authenticate as player", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill("e2e-player@lista.test");
  await page.getByLabel("Password").fill("Test1234!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.context().storageState({ path: PLAYER_AUTH_FILE });
});

setup("authenticate as invitee", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill("e2e-invitee@lista.test");
  await page.getByLabel("Password").fill("Test1234!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.context().storageState({ path: INVITEE_AUTH_FILE });
});
