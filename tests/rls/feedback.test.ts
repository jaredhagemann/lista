import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, cleanupTestData } from "./helpers";

describe("feedback RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("authenticated user can submit feedback", async () => {
    const { client, user } = await createTestUser();
    const { error } = await client.from("feedback").insert({
      user_id: user.id,
      type: "bug",
      description: "This is a test bug report with enough detail.",
    });
    expect(error).toBeNull();
  });

  it("user cannot submit feedback on behalf of another user", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const { error } = await userA.client.from("feedback").insert({
      user_id: userB.user.id,
      type: "feature",
      description: "Trying to spoof another user's feedback submission.",
    });
    expect(error).not.toBeNull();
  });

  it("user cannot read feedback", async () => {
    const { client } = await createTestUser();
    const { data } = await client.from("feedback").select("*");
    expect(data).toHaveLength(0);
  });
});
