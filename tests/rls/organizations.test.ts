import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, cleanupTestData } from "./helpers";

describe("organizations RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("authenticated user can SELECT organizations", async () => {
    const { client } = await createTestUser();

    // Insert an org first
    const orgId = crypto.randomUUID();
    const { error: insertErr } = await client
      .from("organizations")
      .insert({ id: orgId, name: "Test Org" });
    expect(insertErr).toBeNull();

    const { data, error } = await client
      .from("organizations")
      .select()
      .eq("id", orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("Test Org");
  });

  it("authenticated user can INSERT organizations", async () => {
    const { client } = await createTestUser();

    const { error } = await client
      .from("organizations")
      .insert({ name: "New Org" });
    expect(error).toBeNull();
  });
});
