import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

describe("storage RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  describe("avatars bucket", () => {
    it("user can upload to avatars/{own_user_id}/", async () => {
      const { client, user } = await createTestUser();
      const path = `${user.id}/test-${crypto.randomUUID()}.txt`;
      const file = new Blob(["test"], { type: "text/plain" });

      const { error } = await client.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      expect(error).toBeNull();

      // Cleanup
      await client.storage.from("avatars").remove([path]);
    });

    it("manager can upload to avatars/{managed_profile_id}/", async () => {
      const parent = await createTestUser();
      const childId = await createManagedProfile(parent.user.id);
      const path = `${childId}/test-${crypto.randomUUID()}.txt`;
      const file = new Blob(["test"], { type: "text/plain" });

      const { error } = await parent.client.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      expect(error).toBeNull();

      // Cleanup
      await parent.client.storage.from("avatars").remove([path]);
    });

    it("user cannot upload to avatars/{other_user_id}/", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      const path = `${userB.user.id}/test-${crypto.randomUUID()}.txt`;
      const file = new Blob(["test"], { type: "text/plain" });

      const { error } = await userA.client.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      expect(error).not.toBeNull();
    });
  });

  describe("team-images bucket", () => {
    it("team admin can upload to team-images/{team_id}/", async () => {
      const { client, user } = await createTestUser();
      const { teamId } = await createTestTeam(user.id);
      const path = `${teamId}/test-${crypto.randomUUID()}.txt`;
      const file = new Blob(["test"], { type: "text/plain" });

      const { error } = await client.storage
        .from("team-images")
        .upload(path, file, { upsert: true });
      expect(error).toBeNull();

      // Cleanup
      await client.storage.from("team-images").remove([path]);
    });

    it("non-admin cannot upload to team-images/{team_id}/", async () => {
      const coach = await createTestUser();
      const player = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);
      await addTeamMember(teamId, player.user.id, "player");

      const path = `${teamId}/test-${crypto.randomUUID()}.txt`;
      const file = new Blob(["test"], { type: "text/plain" });

      const { error } = await player.client.storage
        .from("team-images")
        .upload(path, file, { upsert: true });
      expect(error).not.toBeNull();
    });
  });
});
