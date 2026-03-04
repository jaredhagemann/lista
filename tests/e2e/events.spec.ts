import { test, expect } from "@playwright/test";
import path from "path";

// Convert a Date to the format expected by datetime-local inputs: "YYYY-MM-DDTHH:MM"
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.describe("Event creation (coach)", () => {
  test.use({ storageState: path.join(__dirname, ".auth/coach.json") });

  test("coach can create a new event from the schedule page", async ({ page }) => {
    await page.goto("/dashboard/schedule");

    // Open the create event dialog
    await page.getByRole("button", { name: /new event/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create event" })).toBeVisible();

    // Fill in the form
    await page.getByLabel("Title").fill("E2E Practice Session");

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 8);
    nextWeek.setHours(10, 0, 0, 0);
    const endTime = new Date(nextWeek);
    endTime.setHours(12, 0, 0, 0);

    await page.locator("#startTime").fill(toDatetimeLocalValue(nextWeek));
    await page.locator("#endTime").fill(toDatetimeLocalValue(endTime));

    // Submit
    await page.getByRole("button", { name: "Create event" }).click();

    // Dialog should close and new event appear in list
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("E2E Practice Session")).toBeVisible();
  });
});

test.describe("Event visibility (player)", () => {
  test.use({ storageState: path.join(__dirname, ".auth/player.json") });

  test("player does not see the New Event button", async ({ page }) => {
    await page.goto("/dashboard/schedule");
    await expect(page.getByRole("button", { name: /new event/i })).not.toBeVisible();
  });

  test("player sees the existing team event", async ({ page }) => {
    await page.goto("/dashboard/schedule");
    await expect(page.getByText("E2E Test Game")).toBeVisible();
  });
});
