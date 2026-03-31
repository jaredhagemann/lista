import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";
import type { Database } from "../../apps/web/src/types/database";

const COACH_AUTH_FILE = path.join(__dirname, ".auth/coach.json");
const MANAGER_AUTH_FILE = path.join(__dirname, ".auth/manager.json");

function getState(): { teamId: string; orgId: string; managerId: string } {
  const raw = fs.readFileSync(path.join(__dirname, ".state.json"), "utf8");
  return JSON.parse(raw);
}

function makeAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Team roster: owner badge ───────────────────────────────────────────────

test.describe("Team roster — owner badge", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  test("team owner shows 'Team Owner' badge on roster page", async ({ page }) => {
    await page.goto("/dashboard/team");
    await expect(page.getByText("Team Owner")).toBeVisible();
  });
});

// ── Settings visibility (owner) ────────────────────────────────────────────

test.describe("Team settings — owner visibility", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  test("owner sees Transfer Ownership section in Team settings", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByText(/transfer ownership/i)).toBeVisible();
  });

  test("owner sees Delete Team section in Team settings", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByRole("button", { name: /delete team/i })).toBeVisible();
  });
});

// ── Settings visibility (non-owner admin) ─────────────────────────────────

test.describe("Team settings — non-owner admin visibility", () => {
  test.use({ storageState: MANAGER_AUTH_FILE });

  test("non-owner admin does not see Transfer Ownership section", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByText(/transfer ownership/i)).not.toBeVisible();
  });

  test("non-owner admin does not see Delete Team button", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByRole("button", { name: /delete team/i })).not.toBeVisible();
  });
});

// ── Delete team dialog UX ─────────────────────────────────────────────────

test.describe("Delete team — dialog UX", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  test("clicking Delete Team opens confirmation dialog", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: /delete team/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("submitting with the wrong team name keeps the dialog open", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: /delete team/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Type the wrong team name and attempt to confirm
    const confirmInput = dialog.getByRole("textbox");
    await confirmInput.fill("Wrong Team Name");
    const confirmButton = dialog.getByRole("button", { name: /permanently delete/i });
    await expect(confirmButton).toBeDisabled();

    // Dialog must still be open
    await expect(dialog).toBeVisible();
  });
});

// ── Ownership transfer dialog UX ──────────────────────────────────────────

test.describe("Transfer ownership — dialog UX", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  test("opening transfer dialog shows eligible admins but not players", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: /transfer ownership/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The manager should appear in the recipient dropdown
    const select = dialog.locator("select, [role='combobox']").first();
    await select.click();
    await expect(dialog.getByText(/manager/i)).toBeVisible();
  });
});

// ── Delete team — full flow (isolated team) ────────────────────────────────
// This suite creates its own disposable team so the main test team is not
// destroyed.  The coach's active_team_id is temporarily switched to the
// disposable team, then restored after each test if needed.

test.describe("Delete team — full flow", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  let disposableTeamId: string;
  let coachProfileId: string;

  test.beforeAll(async () => {
    const { orgId } = getState();
    const admin = makeAdmin();

    // Resolve the coach's profile id from the state or by looking up the user
    const { data: users } = await admin.auth.admin.listUsers();
    const coach = users?.users.find((u) => u.email === "e2e-coach@lista.test");
    if (!coach) throw new Error("Could not find e2e-coach user");
    coachProfileId = coach.id;

    disposableTeamId = crypto.randomUUID();
    const { error: teamErr } = await admin.from("teams").insert({
      id: disposableTeamId,
      name: "Disposable E2E Team",
      organization_id: orgId,
      owner_id: coachProfileId,
    });
    if (teamErr) throw new Error(`Failed to create disposable team: ${teamErr.message}`);

    const { error: memberErr } = await admin.from("team_members").insert({
      team_id: disposableTeamId,
      profile_id: coachProfileId,
      role: "coach",
    });
    if (memberErr) throw new Error(`Failed to add coach to disposable team: ${memberErr.message}`);

    // Switch the coach's active team to the disposable team
    await admin
      .from("profiles")
      .update({ active_team_id: disposableTeamId })
      .eq("id", coachProfileId);
  });

  test.afterAll(async () => {
    // If the team still exists (e.g. a test failed before deletion), clean it up
    const admin = makeAdmin();
    const { data } = await admin
      .from("teams")
      .select("id")
      .eq("id", disposableTeamId)
      .maybeSingle();
    if (data) {
      await admin.from("teams").delete().eq("id", disposableTeamId);
    }

    // Restore active team to the main test team
    const { teamId } = getState();
    await admin
      .from("profiles")
      .update({ active_team_id: teamId })
      .eq("id", coachProfileId);
  });

  test("correct team name confirms deletion and redirects to /dashboard", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: /delete team/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("textbox").fill("Disposable E2E Team");
    await dialog.getByRole("button", { name: /permanently delete/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    // The deleted team name must not appear in the page
    await expect(page.getByText("Disposable E2E Team")).not.toBeVisible();
  });
});

// ── Transfer ownership — full flow (isolated team) ────────────────────────

test.describe("Transfer ownership — full flow", () => {
  test.use({ storageState: COACH_AUTH_FILE });

  let transferTeamId: string;
  let coachProfileId: string;
  let managerId: string;

  test.beforeAll(async () => {
    const state = getState();
    managerId = state.managerId;
    const admin = makeAdmin();

    const { data: users } = await admin.auth.admin.listUsers();
    const coach = users?.users.find((u) => u.email === "e2e-coach@lista.test");
    if (!coach) throw new Error("Could not find e2e-coach user");
    coachProfileId = coach.id;

    transferTeamId = crypto.randomUUID();
    const { error: teamErr } = await admin.from("teams").insert({
      id: transferTeamId,
      name: "Transfer E2E Team",
      organization_id: state.orgId,
      owner_id: coachProfileId,
    });
    if (teamErr) throw new Error(`Failed to create transfer team: ${teamErr.message}`);

    const { error: memberErr } = await admin.from("team_members").insert([
      { team_id: transferTeamId, profile_id: coachProfileId, role: "coach" },
      { team_id: transferTeamId, profile_id: managerId, role: "manager" },
    ]);
    if (memberErr) throw new Error(`Failed to add members to transfer team: ${memberErr.message}`);

    // Switch the coach's active team
    await admin
      .from("profiles")
      .update({ active_team_id: transferTeamId })
      .eq("id", coachProfileId);
  });

  test.afterAll(async () => {
    const admin = makeAdmin();
    await admin.from("teams").delete().eq("id", transferTeamId);

    // Restore active team
    const { teamId } = getState();
    await admin
      .from("profiles")
      .update({ active_team_id: teamId })
      .eq("id", coachProfileId);
  });

  test("after transferring ownership the former owner no longer sees owner controls", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("tab", { name: "Team" }).click();

    // Owner controls should be visible before transfer
    await expect(page.getByRole("button", { name: /transfer ownership/i })).toBeVisible();

    // Open transfer dialog and select the manager
    await page.getByRole("button", { name: /transfer ownership/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Select the manager from the dropdown
    const combobox = dialog.locator("select, [role='combobox']").first();
    await combobox.click();
    // Pick the first (and only) option in the eligible-admins list
    const options = dialog.locator("[role='option'], option");
    await options.first().click();

    await dialog.getByRole("button", { name: /confirm transfer|transfer/i }).click();

    // After transfer, the former owner should no longer see the owner controls
    await expect(page.getByRole("button", { name: /delete team/i })).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/transfer ownership/i)).not.toBeVisible();
  });
});
