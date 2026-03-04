import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Availability RSVP (player)", () => {
  test.use({ storageState: path.join(__dirname, ".auth/player.json") });

  test("player can set availability on the matrix", async ({ page }) => {
    await page.goto("/dashboard/availability");

    // Wait for the availability matrix to load
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    // Find the player's own availability cell for the E2E Test Game event
    // Cells for the current user have title="Click to cycle your availability"
    const cell = page.getByTitle("Click to cycle your availability").first();
    await expect(cell).toBeVisible();

    // Click to cycle from null → available
    await cell.click();

    // After clicking, the cell should now show the "Available" chip
    // StatusChip for "available" renders a ✓ and has bg-green-*
    // We verify by checking the title of the chip inside the cell
    await expect(cell.getByTitle("Available")).toBeVisible({ timeout: 5_000 });
  });

  test("player can update availability from available to maybe", async ({ page }) => {
    await page.goto("/dashboard/availability");
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    const cell = page.getByTitle("Click to cycle your availability").first();
    await expect(cell).toBeVisible();

    // Ensure we start at "available" (from the previous test) and click to "maybe"
    // The cycle is: null → available → maybe → unavailable → null
    // First, advance to "available" if not already there
    const chipTitle = await cell.locator("span").getAttribute("title");
    if (chipTitle !== "Available") {
      await cell.click();
      await expect(cell.getByTitle("Available")).toBeVisible({ timeout: 5_000 });
    }

    // Now advance to "maybe"
    await cell.click();
    await expect(cell.getByTitle("Maybe")).toBeVisible({ timeout: 5_000 });
  });
});
