import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, createTestTeam, adminClient, cleanupTestData, trackIds } from "./helpers";

describe("organizations RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── INSERT ────────────────────────────────────────────────────────────────

  it("authenticated client cannot INSERT an organization directly", async () => {
    const { client } = await createTestUser();

    const { error } = await client
      .from("organizations")
      .insert({ name: "Direct Insert Org", slug: "direct-insert-org" });

    // Default-deny: no permissive INSERT policy exists.
    // Org creation must go through the create_team() service-role RPC.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501"); // RLS violation
  });

  it("org is created via create_team() RPC and owner can SELECT it", async () => {
    const { client, user } = await createTestUser();

    // The /api/teams server route calls create_team() via the service-role admin
    // client. Simulate that here by calling via adminClient.
    const { data: teamId, error: rpcError } = await adminClient.rpc("create_team", {
      owner_profile_id: user.id,
      team_name: "RPC Test Team",
      season: "2026",
      org_name: "RPC Test Org",
    });
    expect(rpcError).toBeNull();

    // Resolve the org created by the RPC and register both for cleanup
    const { data: teamRow } = await adminClient
      .from("teams")
      .select("organization_id")
      .eq("id", teamId as string)
      .single();
    const orgId = teamRow!.organization_id!;
    trackIds({ teamId: teamId as string, orgId });

    // The RPC enrolls the owner as a team member, so the SELECT policy grants
    // them visibility of the org.
    const { data, error } = await client
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });

  // ── SELECT ────────────────────────────────────────────────────────────────

  it("team member can SELECT their own org", async () => {
    const { client, user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { data, error } = await client
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });

  it("user cannot SELECT an org they have no membership in", async () => {
    const { user: userA } = await createTestUser();
    const { orgId } = await createTestTeam(userA.id);

    const { client: clientB } = await createTestUser();
    const { data, error } = await clientB
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS filters the row out
  });

  it("org member (organization_members row) can SELECT the org", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    // Get a signed-in client for the director BEFORE inserting the row
    const { client: dirClient, user: director } = await createTestUser();

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: director.id, role: "director" });

    const { data, error } = await dirClient
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });
});
