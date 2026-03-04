import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

function getState(): { invitationId: string; teamId: string } {
  const raw = fs.readFileSync(path.join(__dirname, ".state.json"), "utf8");
  return JSON.parse(raw);
}

test.describe("Invitation acceptance (invitee)", () => {
  test.use({ storageState: path.join(__dirname, ".auth/invitee.json") });

  test("invitee can accept a team invitation", async ({ page }) => {
    const { invitationId } = getState();

    await page.goto(`/invite/${invitationId}`);

    // Should show the invitation card with team name and role
    await expect(page.getByText("E2E Test Team")).toBeVisible();
    await expect(page.getByText(/player/i)).toBeVisible();

    // Accept the invitation
    await page.getByRole("button", { name: "Accept & join team" }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
