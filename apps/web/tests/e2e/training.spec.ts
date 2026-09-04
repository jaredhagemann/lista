/**
 * E2E for Individual Training Tracking (spec §5).
 * Self-contained fixtures: a club-tier org with a player, and a free-tier org
 * with a user, plus a parent managing two children on two club teams.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let admin: SupabaseClient<Database>;
const password = "TestPass1234!";
const ts = Date.now();

// club fixture
const clubPlayerEmail = `train-player-${ts}@lista-test.example`;
let clubOrgId: string;
let clubTeamId: string;
let clubPlayerId: string;

// free fixture
const freeUserEmail = `train-free-${ts}@lista-test.example`;
let freeTeamId: string;
let freeOrgId: string;
let freeUserId: string;

// parent-of-two fixture
const parentEmail = `train-parent-${ts}@lista-test.example`;
let parentTeamAId: string;
let parentTeamBId: string;
let childAId: string;
let childBId: string;

async function createUser(email: string, firstName: string, lastName: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
  await admin.from("profiles").update({ first_name: firstName, last_name: lastName }).eq("id", data.user.id);
  return data.user.id;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test.beforeAll(async () => {
  admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // ── Club fixture ──
  clubOrgId = crypto.randomUUID();
  clubTeamId = crypto.randomUUID();
  await admin.from("organizations").insert({
    id: clubOrgId,
    name: `Train Club ${ts}`,
    slug: `train-club-${ts}`,
    plan: "club_small",
    subscription_status: "active",
  });
  const clubOwnerId = await createUser(`train-coach-${ts}@lista-test.example`, "Cara", "Coach");
  await admin.from("teams").insert({ id: clubTeamId, name: `Club Team ${ts}`, organization_id: clubOrgId, owner_id: clubOwnerId });
  await admin.from("team_members").insert({ team_id: clubTeamId, profile_id: clubOwnerId, role: "coach" });

  clubPlayerId = await createUser(clubPlayerEmail, "Pat", "Player");
  await admin.from("team_members").insert({ team_id: clubTeamId, profile_id: clubPlayerId, role: "player" });
  await admin.from("profiles").update({ active_team_id: clubTeamId }).eq("id", clubPlayerId);

  // ── Free fixture ──
  freeOrgId = crypto.randomUUID();
  freeTeamId = crypto.randomUUID();
  await admin.from("organizations").insert({ id: freeOrgId, name: `Train Free ${ts}`, slug: `train-free-${ts}` });
  freeUserId = await createUser(freeUserEmail, "Fred", "Free");
  await admin.from("teams").insert({ id: freeTeamId, name: `Free Team ${ts}`, organization_id: freeOrgId, owner_id: freeUserId });
  await admin.from("team_members").insert({ team_id: freeTeamId, profile_id: freeUserId, role: "player" });
  await admin.from("profiles").update({ active_team_id: freeTeamId }).eq("id", freeUserId);

  // ── Parent-of-two fixture (same club org, two teams) ──
  parentTeamAId = crypto.randomUUID();
  parentTeamBId = crypto.randomUUID();
  const parentId = await createUser(parentEmail, "Paula", "Parent");
  await admin.from("teams").insert([
    { id: parentTeamAId, name: `Club A ${ts}`, organization_id: clubOrgId, owner_id: parentId },
    { id: parentTeamBId, name: `Club B ${ts}`, organization_id: clubOrgId, owner_id: parentId },
  ]);
  // Parent is a manager on both teams (so they can view training there)
  await admin.from("team_members").insert([
    { team_id: parentTeamAId, profile_id: parentId, role: "manager" },
    { team_id: parentTeamBId, profile_id: parentId, role: "manager" },
  ]);
  await admin.from("profiles").update({ active_team_id: parentTeamAId }).eq("id", parentId);

  // Two managed children, each a player on one team
  childAId = crypto.randomUUID();
  childBId = crypto.randomUUID();
  await admin.from("profiles").insert([
    { id: childAId, first_name: "Amy", last_name: "Child", email: `child-a-${ts}@lista-test.example`, active_team_id: parentTeamAId },
    { id: childBId, first_name: "Ben", last_name: "Child", email: `child-b-${ts}@lista-test.example`, active_team_id: parentTeamBId },
  ]);
  await admin.from("profile_managers").insert([
    { manager_id: parentId, managed_id: childAId, relationship: "parent" },
    { manager_id: parentId, managed_id: childBId, relationship: "parent" },
  ]);
  await admin.from("team_members").insert([
    { team_id: parentTeamAId, profile_id: childAId, role: "player" },
    { team_id: parentTeamBId, profile_id: childBId, role: "player" },
  ]);
});

test.afterAll(async () => {
  // Delete auth users (cascades their profiles/memberships), then org rows.
  const { data } = await admin.auth.admin.listUsers();
  for (const u of data?.users ?? []) {
    if (u.email?.startsWith("train-") && u.email.includes(`${ts}`)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("profiles").delete().in("id", [childAId, childBId]);
  await admin.from("teams").delete().in("id", [clubTeamId, freeTeamId, parentTeamAId, parentTeamBId]);
  await admin.from("organizations").delete().in("id", [clubOrgId, freeOrgId]);
});

test("club player: log a session → appears in My Training → appears on the leaderboard", async ({ page }) => {
  await login(page, clubPlayerEmail);

  // Training nav item is present (club gate passed)
  await expect(page.getByRole("link", { name: "Training" })).toBeVisible();
  await page.getByRole("link", { name: "Training" }).click();
  await page.waitForURL("**/dashboard/training");

  // Log a session
  await page.getByRole("tab", { name: "My Training" }).click();
  await page.getByRole("button", { name: /Log session/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "45" }).click(); // duration quick-pick
  await dialog.getByRole("button", { name: "Log session" }).click();

  // Appears in My Training
  await expect(page.getByText(/·\s*45\s*min/)).toBeVisible();

  // Appears on the leaderboard
  await page.getByRole("tab", { name: "Leaderboard" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Pat Player" });
  await expect(row).toBeVisible();
  await expect(row.getByText("45 min", { exact: true })).toBeVisible();
});

test("free-tier user: no Training nav item; /dashboard/training redirects to the plan tab", async ({ page }) => {
  await login(page, freeUserEmail);

  await expect(page.getByRole("link", { name: "Training" })).toHaveCount(0);

  await page.goto("/dashboard/training");
  await page.waitForURL("**/dashboard/settings**");
  expect(page.url()).toContain("tab=plan");
});

test("parent logs for a managed child via the profile switcher (correct attribution)", async ({ page }) => {
  await login(page, parentEmail);

  // Switch active profile from the parent to the managed child (Amy, on team A).
  await page.getByRole("button", { name: /Paula Parent/ }).click();
  await page.getByRole("menuitem", { name: /Amy Child/ }).click();
  // Wait for the switch to actually take effect (nav re-renders as "Viewing as")
  // — we're already on /dashboard, so a URL wait would return immediately.
  await expect(page.getByRole("button", { name: /Viewing as: Amy/i })).toBeVisible();

  // Log a session as the active child.
  await page.goto("/dashboard/training");
  await page.getByRole("tab", { name: "My Training" }).click();
  await page.getByRole("button", { name: /Log session/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "30", exact: true }).click();
  await dialog.getByRole("button", { name: "Log session" }).click();
  await expect(page.getByText(/·\s*30\s*min/)).toBeVisible();

  // Attribution: the session belongs to the CHILD on team A, entered BY the parent.
  const parentId = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === parentEmail)!.id;
  const { data: aSessions } = await admin
    .from("training_sessions")
    .select("profile_id, team_id, duration_minutes, created_by")
    .eq("profile_id", childAId);
  expect(aSessions).toHaveLength(1);
  expect(aSessions![0]).toMatchObject({ team_id: parentTeamAId, duration_minutes: 30, created_by: parentId });
});
