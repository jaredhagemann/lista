import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, cleanupTestData, adminClient } from "./helpers";

describe("push_subscriptions RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("user can INSERT own push subscription", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client.from("push_subscriptions").insert({
      profile_id: user.id,
      endpoint: "https://push.example.com/sub1",
      p256dh: "test-p256dh",
      auth: "test-auth",
    });
    expect(error).toBeNull();
  });

  it("user can SELECT own push subscriptions", async () => {
    const { client, user } = await createTestUser();

    await adminClient.from("push_subscriptions").insert({
      profile_id: user.id,
      endpoint: "https://push.example.com/sub2",
      p256dh: "test-p256dh",
      auth: "test-auth",
    });

    const { data, error } = await client
      .from("push_subscriptions")
      .select()
      .eq("profile_id", user.id);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("user cannot see others' push subscriptions", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    await adminClient.from("push_subscriptions").insert({
      profile_id: user2.user.id,
      endpoint: "https://push.example.com/sub3",
      p256dh: "test-p256dh",
      auth: "test-auth",
    });

    const { data, error } = await user1.client
      .from("push_subscriptions")
      .select()
      .eq("profile_id", user2.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user can DELETE own push subscription", async () => {
    const { client, user } = await createTestUser();

    const subId = crypto.randomUUID();
    await adminClient.from("push_subscriptions").insert({
      id: subId,
      profile_id: user.id,
      endpoint: "https://push.example.com/sub4",
      p256dh: "test-p256dh",
      auth: "test-auth",
    });

    const { error } = await client
      .from("push_subscriptions")
      .delete()
      .eq("id", subId);
    expect(error).toBeNull();
  });
});
