import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, createTestTeam, adminClient, cleanupTestData } from "./helpers";

describe("organization_members RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── SELECT ────────────────────────────────────────────────────────────────

  it("org owner can SELECT their own organization_members row", async () => {
    const { client, user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: user.id, role: "owner" });

    const { data, error } = await client
      .from("organization_members")
      .select()
      .eq("organization_id", orgId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    expect(data!.some((r) => r.profile_id === user.id)).toBe(true);
  });

  it("org director can SELECT the full org_members list", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner.id, role: "owner" });

    // Get a signed-in client for the director BEFORE inserting the row
    const { client: dirClient, user: director } = await createTestUser();
    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: director.id, role: "director" });

    const { data, error } = await dirClient
      .from("organization_members")
      .select()
      .eq("organization_id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.some((r) => r.profile_id === director.id)).toBe(true);
    expect(data!.some((r) => r.profile_id === owner.id)).toBe(true);
  });

  it("user with no org membership cannot SELECT organization_members for that org", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner.id, role: "owner" });

    const { client: outsiderClient } = await createTestUser();
    const { data, error } = await outsiderClient
      .from("organization_members")
      .select()
      .eq("organization_id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS filters all rows
  });

  // ── INSERT / DELETE (owner-only management) ───────────────────────────────

  it("non-owner cannot INSERT into organization_members", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner.id, role: "owner" });

    const { client: outsiderClient, user: outsider } = await createTestUser();
    const { error } = await outsiderClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: outsider.id, role: "director" });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  // ── Uniqueness constraint ─────────────────────────────────────────────────

  it("only one owner row is allowed per org (partial unique index)", async () => {
    const { user: owner1 } = await createTestUser();
    const { orgId } = await createTestTeam(owner1.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner1.id, role: "owner" });

    const { user: owner2 } = await createTestUser();
    const { error } = await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner2.id, role: "owner" });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505"); // unique_violation
  });

  it("multiple directors are allowed in the same org", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: owner.id, role: "owner" });

    const { user: dir1 } = await createTestUser();
    const { user: dir2 } = await createTestUser();

    const { error: e1 } = await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: dir1.id, role: "director" });
    const { error: e2 } = await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: dir2.id, role: "director" });

    expect(e1).toBeNull();
    expect(e2).toBeNull();
  });
});
