import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  createManagedProfile,
  setOrgPlan,
  trackIds,
  adminClient,
  cleanupTestData,
  getDefaultCategoryId,
  createCategory,
  insertSession,
  todayStr,
} from "./helpers";

/** Coach + club-tier org + team. */
async function clubTeam() {
  const coach = await createTestUser();
  const { orgId, teamId } = await createTestTeam(coach.user.id);
  await setOrgPlan(orgId, "club_small", "active");
  return { coach, orgId, teamId };
}

/** Add a second team to an existing org, owned/coached by a fresh user. */
async function secondTeam(orgId: string) {
  const coach2 = await createTestUser();
  const teamId = crypto.randomUUID();
  await adminClient
    .from("teams")
    .insert({ id: teamId, organization_id: orgId, name: `T2 ${teamId.slice(0, 8)}`, owner_id: coach2.user.id });
  trackIds({ teamId });
  await adminClient.from("team_members").insert({ team_id: teamId, profile_id: coach2.user.id, role: "coach" });
  return { coach2, teamId };
}

describe("training_categories RLS + seeding + invariants", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── Seeding + invariants ────────────────────────────────────────────────

  it("team creation seeds exactly one General default", async () => {
    const { teamId } = await clubTeam();
    const { data } = await adminClient
      .from("training_categories")
      .select("label, is_default, sort_order, is_active, created_by")
      .eq("team_id", teamId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      label: "General",
      is_default: true,
      sort_order: 0,
      is_active: true,
      created_by: null,
    });
  });

  it("a second is_default row is rejected", async () => {
    const { teamId } = await clubTeam();
    const { error } = await adminClient
      .from("training_categories")
      .insert({ team_id: teamId, label: "General", is_default: true, sort_order: 0, created_by: null });
    expect(error).not.toBeNull();
  });

  it("an is_default insert with a non-canonical shape is rejected", async () => {
    const { teamId } = await clubTeam();
    // Wrong label/order/active/created_by all violate the guard's default shape.
    const { error } = await adminClient
      .from("training_categories")
      .insert({ team_id: teamId, label: "Nope", is_default: true, sort_order: 3, created_by: null });
    expect(error).not.toBeNull();
  });

  it("a service-role custom insert with null created_by is rejected (CHECK)", async () => {
    const { teamId } = await clubTeam();
    const { error } = await adminClient
      .from("training_categories")
      .insert({ team_id: teamId, label: "Orphan", is_default: false, sort_order: 10, created_by: null });
    expect(error).not.toBeNull();
  });

  // ── SELECT ───────────────────────────────────────────────────────────────

  it("a roster player can select their team's categories; a non-member cannot", async () => {
    const { teamId } = await clubTeam();
    await createCategory(teamId, "Dribbling");
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const seen = await player.client.from("training_categories").select("label").eq("team_id", teamId);
    expect(seen.error).toBeNull();
    expect(seen.data!.map((c) => c.label).sort()).toEqual(["Dribbling", "General"]);

    const outsider = await createTestUser();
    const denied = await outsider.client.from("training_categories").select("id").eq("team_id", teamId);
    expect(denied.data ?? []).toHaveLength(0);
  });

  // ── Write authorization ────────────────────────────────────────────────

  it("coach/manager/director/owner can add; player/parent cannot", async () => {
    const { coach, orgId, teamId } = await clubTeam();
    const manager = await createTestUser();
    await addTeamMember(teamId, manager.user.id, "manager");
    const director = await createTestUser();
    await addOrgMember(orgId, director.user.id, "director");
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, child, "player");

    const add = (client: typeof coach.client, label: string) =>
      client.from("training_categories").insert({ team_id: teamId, label, is_default: false, sort_order: 10 });

    expect((await add(coach.client, "Coach Cat")).error).toBeNull();
    expect((await add(manager.client, "Manager Cat")).error).toBeNull();
    expect((await add(director.client, "Director Cat")).error).toBeNull();
    expect((await add(player.client, "Player Cat")).error).not.toBeNull();
    expect((await add(parent.client, "Parent Cat")).error).not.toBeNull();
  });

  it("a coach of another team in the same org cannot add to this team", async () => {
    const { orgId, teamId } = await clubTeam();
    const { coach2 } = await secondTeam(orgId);
    const { error } = await coach2.client
      .from("training_categories")
      .insert({ team_id: teamId, label: "Foreign", is_default: false, sort_order: 10 });
    expect(error).not.toBeNull();
  });

  it("an authenticated custom insert stamps created_by = the caller", async () => {
    const { coach, teamId } = await clubTeam();
    const { data, error } = await coach.client
      .from("training_categories")
      .insert({ team_id: teamId, label: "Passing", is_default: false, sort_order: 10 })
      .select("created_by")
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(coach.user.id);
  });

  // ── Club gate ──────────────────────────────────────────────────────────

  it("writes require club access on insert/update/delete", async () => {
    const { coach, orgId, teamId } = await clubTeam();
    const catId = await createCategory(teamId, "Fitness");

    await setOrgPlan(orgId, "free", "canceled");
    // insert: WITH CHECK violation returns an explicit error
    expect(
      (await coach.client.from("training_categories").insert({ team_id: teamId, label: "New", is_default: false, sort_order: 20 }))
        .error
    ).not.toBeNull();
    // update: the USING clause filters the row out → 0 rows, no error, but the
    // row must be unchanged.
    await coach.client.from("training_categories").update({ label: "Renamed" }).eq("id", catId);
    const afterUpdate = await adminClient.from("training_categories").select("label").eq("id", catId).single();
    expect(afterUpdate.data!.label).toBe("Fitness");
    // delete: likewise filtered out → the category remains.
    await coach.client.from("training_categories").delete().eq("id", catId);
    const still = await adminClient.from("training_categories").select("id").eq("id", catId).maybeSingle();
    expect(still.data).not.toBeNull();

    // Restore club access → writes allowed again.
    await setOrgPlan(orgId, "club_small", "trialing");
    expect(
      (await coach.client.from("training_categories").update({ label: "Renamed2" }).eq("id", catId)).error
    ).toBeNull();

    // Seeded default still present throughout.
    expect(await getDefaultCategoryId(teamId)).toBeTruthy();
  });

  // ── Unique label ──────────────────────────────────────────────────────

  it("duplicate labels within a team are rejected (case/space-insensitive); allowed across teams", async () => {
    const { orgId, teamId } = await clubTeam();
    await createCategory(teamId, "Shooting");
    const dup = await adminClient
      .from("training_categories")
      .insert({ team_id: teamId, label: " shooting ", is_default: false, sort_order: 20, created_by: (await adminClient.from("teams").select("owner_id").eq("id", teamId).single()).data!.owner_id });
    expect(dup.error).not.toBeNull();

    const { teamId: team2 } = await secondTeam(orgId);
    await expect(createCategory(team2, "Shooting")).resolves.toBeTruthy();
  });

  // ── Rename / audit immutability ─────────────────────────────────────────

  it("rename propagates to sessions; created_by/created_at preserved, updated_at advances", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const catId = await createCategory(teamId, "Endurance", { createdBy: coach.user.id });
    await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, categoryId: catId });

    const before = await adminClient
      .from("training_categories")
      .select("created_by, created_at, updated_at")
      .eq("id", catId)
      .single();

    // Rename via coach (authorized), attempting to also forge created_by.
    const { error } = await coach.client
      .from("training_categories")
      .update({ label: "Conditioning", created_by: player.user.id })
      .eq("id", catId);
    expect(error).toBeNull();

    const after = await adminClient
      .from("training_categories")
      .select("label, created_by, created_at, updated_at")
      .eq("id", catId)
      .single();
    expect(after.data!.label).toBe("Conditioning");
    expect(after.data!.created_by).toBe(coach.user.id); // forge ignored
    expect(after.data!.created_at).toBe(before.data!.created_at);
    expect(new Date(after.data!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.data!.updated_at).getTime()
    );

    // Session resolves the new label via the FK join.
    const sess = await adminClient
      .from("training_sessions")
      .select("training_categories(label)")
      .eq("team_id", teamId)
      .single();
    expect((sess.data as any).training_categories.label).toBe("Conditioning");
  });

  it("a category's team_id is immutable", async () => {
    const { orgId, teamId } = await clubTeam();
    const { teamId: team2 } = await secondTeam(orgId);
    const catId = await createCategory(teamId, "Speed");
    const { error } = await adminClient.from("training_categories").update({ team_id: team2 }).eq("id", catId);
    expect(error).not.toBeNull();
  });

  // ── Archive + restore ───────────────────────────────────────────────────

  it("archive hides from active set; restore returns the same row", async () => {
    const { coach, teamId } = await clubTeam();
    const catId = await createCategory(teamId, "Agility", { createdBy: coach.user.id, sortOrder: 30 });

    expect((await coach.client.from("training_categories").update({ is_active: false }).eq("id", catId)).error).toBeNull();
    const active = await adminClient
      .from("training_categories")
      .select("id")
      .eq("team_id", teamId)
      .eq("is_active", true);
    expect(active.data!.map((c) => c.id)).not.toContain(catId);

    expect((await coach.client.from("training_categories").update({ is_active: true }).eq("id", catId)).error).toBeNull();
    const restored = await adminClient
      .from("training_categories")
      .select("label, sort_order, created_by, is_active")
      .eq("id", catId)
      .single();
    expect(restored.data).toMatchObject({ label: "Agility", sort_order: 30, created_by: coach.user.id, is_active: true });
  });

  // ── Default protection (full matrix) ─────────────────────────────────────

  it("the default cannot be deleted, archived, renamed, reordered, or demoted", async () => {
    const { teamId } = await clubTeam();
    const defId = await getDefaultCategoryId(teamId);

    // delete
    await adminClient.from("training_categories").delete().eq("id", defId);
    // archive
    const arch = await adminClient.from("training_categories").update({ is_active: false }).eq("id", defId);
    // rename
    const ren = await adminClient.from("training_categories").update({ label: "Main" }).eq("id", defId);
    // reorder
    const ord = await adminClient.from("training_categories").update({ sort_order: 5 }).eq("id", defId);
    // demote
    const dem = await adminClient.from("training_categories").update({ is_default: false }).eq("id", defId);

    expect(arch.error).not.toBeNull();
    expect(ren.error).not.toBeNull();
    expect(ord.error).not.toBeNull();
    expect(dem.error).not.toBeNull();

    // Invariant holds: still exactly one active General default at position 0.
    const { data } = await adminClient
      .from("training_categories")
      .select("label, is_default, sort_order, is_active")
      .eq("team_id", teamId)
      .eq("is_default", true);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ label: "General", sort_order: 0, is_active: true });
  });

  // ── A non-default with sessions can't be hard-deleted, but can be archived ─

  it("a non-default category with sessions cannot be hard-deleted (FK), but can be archived", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const catId = await createCategory(teamId, "Strength", { createdBy: coach.user.id });
    await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, categoryId: catId });

    const del = await adminClient.from("training_categories").delete().eq("id", catId);
    expect(del.error).not.toBeNull(); // RESTRICT

    const arch = await coach.client.from("training_categories").update({ is_active: false }).eq("id", catId);
    expect(arch.error).toBeNull();
  });
});
