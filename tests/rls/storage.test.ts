import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
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

  describe("org-images bucket", () => {
    // createTestTeam only inserts a team_members row; org-images RLS checks
    // organization_members, so we insert that separately via adminClient.
    async function createOrgOwner() {
      const owner = await createTestUser();
      const { orgId } = await createTestTeam(owner.user.id);
      await adminClient
        .from("organization_members")
        .insert({ organization_id: orgId, profile_id: owner.user.id, role: "owner" });
      return { owner, orgId };
    }

    it("org owner can upload to org-images/{orgId}/", async () => {
      const { owner, orgId } = await createOrgOwner();
      const { error } = await owner.client.storage
        .from("org-images")
        .upload(`${orgId}/logo`, new Blob(["x"], { type: "image/png" }), {
          upsert: true,
          contentType: "image/png",
        });
      expect(error).toBeNull();

      await adminClient.storage.from("org-images").remove([`${orgId}/logo`]);
    });

    it("org owner can re-upload the same path (upsert requires SELECT)", async () => {
      const { owner, orgId } = await createOrgOwner();
      const path = `${orgId}/logo`;
      await adminClient.storage
        .from("org-images")
        .upload(path, new Blob(["v1"], { type: "image/png" }), { upsert: true });

      const { error } = await owner.client.storage
        .from("org-images")
        .upload(path, new Blob(["v2"], { type: "image/png" }), {
          upsert: true,
          contentType: "image/png",
        });
      expect(error).toBeNull();

      await adminClient.storage.from("org-images").remove([path]);
    });

    it("org owner can delete from org-images/{orgId}/", async () => {
      const { owner, orgId } = await createOrgOwner();
      const path = `${orgId}/logo`;
      await adminClient.storage
        .from("org-images")
        .upload(path, new Blob(["x"], { type: "image/png" }), { upsert: true });

      const { error } = await owner.client.storage
        .from("org-images")
        .remove([path]);
      expect(error).toBeNull();
    });

    it("non-owner org member cannot upload to org-images/{orgId}/", async () => {
      const owner = await createTestUser();
      const director = await createTestUser();
      const { orgId } = await createTestTeam(owner.user.id);
      await adminClient.from("organization_members").insert([
        { organization_id: orgId, profile_id: owner.user.id, role: "owner" },
        { organization_id: orgId, profile_id: director.user.id, role: "director" },
      ]);

      const { error } = await director.client.storage
        .from("org-images")
        .upload(`${orgId}/logo`, new Blob(["x"], { type: "image/png" }), {
          upsert: true,
          contentType: "image/png",
        });
      expect(error).not.toBeNull();
    });

    it("non-member cannot upload to org-images/{orgId}/", async () => {
      const { orgId } = await createOrgOwner();
      const stranger = await createTestUser();

      const { error } = await stranger.client.storage
        .from("org-images")
        .upload(`${orgId}/logo`, new Blob(["x"], { type: "image/png" }), {
          upsert: true,
          contentType: "image/png",
        });
      expect(error).not.toBeNull();
    });
  });
});
