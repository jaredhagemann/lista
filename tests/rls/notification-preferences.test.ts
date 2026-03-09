import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, cleanupTestData, adminClient } from "./helpers";

describe("notification_preferences RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("user can INSERT own notification preferences", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client.from("notification_preferences").insert({
      profile_id: user.id,
      email_enabled: true,
      push_enabled: false,
    });
    expect(error).toBeNull();
  });

  it("user can SELECT own notification preferences", async () => {
    const { client, user } = await createTestUser();

    await adminClient.from("notification_preferences").insert({
      profile_id: user.id,
      email_enabled: true,
      push_enabled: true,
    });

    const { data, error } = await client
      .from("notification_preferences")
      .select()
      .eq("profile_id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("user cannot see others' notification preferences", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    await adminClient.from("notification_preferences").insert({
      profile_id: user2.user.id,
      email_enabled: true,
      push_enabled: true,
    });

    const { data, error } = await user1.client
      .from("notification_preferences")
      .select()
      .eq("profile_id", user2.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user can UPDATE own notification preferences", async () => {
    const { client, user } = await createTestUser();

    await adminClient.from("notification_preferences").insert({
      profile_id: user.id,
      email_enabled: true,
      push_enabled: true,
    });

    const { error } = await client
      .from("notification_preferences")
      .update({ push_enabled: false })
      .eq("profile_id", user.id);
    expect(error).toBeNull();

    const { data } = await client
      .from("notification_preferences")
      .select()
      .eq("profile_id", user.id);
    expect(data![0].push_enabled).toBe(false);
  });

  it("new notification preferences default chat columns to true", async () => {
    const { client, user } = await createTestUser();

    await client.from("notification_preferences").insert({
      profile_id: user.id,
    });

    const { data, error } = await client
      .from("notification_preferences")
      .select()
      .eq("profile_id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data!.chat_push_enabled).toBe(true);
    expect(data!.chat_digest_enabled).toBe(true);
  });

  it("user can UPDATE chat notification preferences", async () => {
    const { client, user } = await createTestUser();

    await adminClient.from("notification_preferences").insert({
      profile_id: user.id,
    });

    const { error } = await client
      .from("notification_preferences")
      .update({ chat_push_enabled: false, chat_digest_enabled: false })
      .eq("profile_id", user.id);
    expect(error).toBeNull();

    const { data } = await client
      .from("notification_preferences")
      .select()
      .eq("profile_id", user.id)
      .single();
    expect(data!.chat_push_enabled).toBe(false);
    expect(data!.chat_digest_enabled).toBe(false);
  });

  it("user cannot UPDATE others' notification preferences", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    await adminClient.from("notification_preferences").insert({
      profile_id: user2.user.id,
      email_enabled: true,
      push_enabled: true,
    });

    await user1.client
      .from("notification_preferences")
      .update({ push_enabled: false })
      .eq("profile_id", user2.user.id);

    // Verify unchanged
    const { data } = await adminClient
      .from("notification_preferences")
      .select()
      .eq("profile_id", user2.user.id);
    expect(data![0].push_enabled).toBe(true);
  });
});
