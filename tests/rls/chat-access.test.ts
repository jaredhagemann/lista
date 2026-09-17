/**
 * BUG-003: chat access control.
 *
 * Specs (docs/specs/archive/team-chat.md, docs/specs/multi-tenant-architecture.md):
 *   - private groups are entirely private; members are added by the group's
 *     creator or a team admin, never by joining yourself
 *   - directors (and other admins) are not auto-enrolled in groups and cannot
 *     read them unless invited
 *   - no message editing in v1: a message may only be soft-deleted
 *   - removal from a team revokes access to that team's chat, DMs included,
 *     unless another legitimate source of access remains (e.g. a managed child)
 *
 * Who may DM whom is deliberately unchanged (adult-to-child policy deferred).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function privateGroup(teamId: string, creator: TestUser, members: TestUser[] = []) {
  const channelId = crypto.randomUUID();
  await adminClient.from("channels").insert({
    id: channelId,
    team_id: teamId,
    name: "Private group",
    type: "group",
    created_by: creator.user.id,
  });
  await adminClient
    .from("channel_members")
    .insert([creator, ...members].map((m) => ({ channel_id: channelId, profile_id: m.user.id })));
  await adminClient.from("messages").insert({
    channel_id: channelId,
    sender_id: creator.user.id,
    body: "Group-only message",
  });
  return channelId;
}

async function teamChannel(teamId: string) {
  const { data } = await adminClient
    .from("channels")
    .select("id")
    .eq("team_id", teamId)
    .eq("type", "team")
    .single();
  return data!.id as string;
}

async function isGroupMember(channelId: string, profileId: string) {
  const { data } = await adminClient
    .from("channel_members")
    .select("id")
    .eq("channel_id", channelId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return !!data;
}

async function dm(teamId: string, a: TestUser, b: TestUser) {
  const [profileA, profileB] = [a.user.id, b.user.id].sort();
  const dmId = crypto.randomUUID();
  await adminClient.from("dm_channels").insert({ id: dmId, team_id: teamId, profile_a: profileA, profile_b: profileB });
  await adminClient.from("messages").insert({ dm_channel_id: dmId, sender_id: a.user.id, body: "Private DM" });
  return dmId;
}

/** Mirrors removeTeamMember: the roster row and channel memberships go; DMs are untouched. */
async function removeFromTeam(teamId: string, user: TestUser) {
  const { data: channels } = await adminClient.from("channels").select("id").eq("team_id", teamId);
  await adminClient
    .from("channel_members")
    .delete()
    .eq("profile_id", user.user.id)
    .in("channel_id", (channels ?? []).map((c) => c.id));
  await adminClient.from("team_members").delete().eq("team_id", teamId).eq("profile_id", user.user.id);
}

// ── Group admission ───────────────────────────────────────────────────────────

describe("private groups: admission (BUG-003)", () => {
  it("a team member cannot add themselves to a private group", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await privateGroup(teamId, coach);

    const { error } = await player.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: player.user.id });
    expect(error).not.toBeNull();

    const { data } = await player.client.from("messages").select("id").eq("channel_id", channelId);
    expect(data).toHaveLength(0);
  });

  it("a team admin cannot add themselves to a group they were not invited to", async () => {
    const creator = await createTestUser();
    const assistantCoach = await createTestUser();
    const { teamId } = await createTestTeam(creator.user.id);
    await addTeamMember(teamId, assistantCoach.user.id, "coach");
    const channelId = await privateGroup(teamId, creator);

    const { error } = await assistantCoach.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: assistantCoach.user.id });
    expect(error).not.toBeNull();
    expect(await isGroupMember(channelId, assistantCoach.user.id)).toBe(false);
  });

  it("an org director cannot add themselves to a team's private group", async () => {
    const coach = await createTestUser();
    const director = await createTestUser();
    const { orgId, teamId } = await createTestTeam(coach.user.id);
    await addOrgMember(orgId, director.user.id, "director");
    const channelId = await privateGroup(teamId, coach);

    const { error } = await director.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: director.user.id });
    expect(error).not.toBeNull();
    expect(await isGroupMember(channelId, director.user.id)).toBe(false);
  });

  it("the creator cannot add someone who is not on the team", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const channelId = await privateGroup(teamId, coach);

    const { error } = await coach.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: outsider.user.id });
    expect(error).not.toBeNull();
    expect(await isGroupMember(channelId, outsider.user.id)).toBe(false);
  });

  it("a member creating a group can add themselves and teammates, as the app does", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, childId, "player");

    const channelId = crypto.randomUUID();
    const { error: channelError } = await player.client
      .from("channels")
      .insert({ id: channelId, team_id: teamId, name: "Carpool", type: "group", created_by: player.user.id });
    expect(channelError).toBeNull();

    // A teammate, a parent who manages a player on the team, and the creator.
    const { error } = await player.client.from("channel_members").insert(
      [player.user.id, coach.user.id, parent.user.id].map((id) => ({ channel_id: channelId, profile_id: id }))
    );
    expect(error).toBeNull();
  });

  it("a team admin can still add another team member to a group", async () => {
    const creator = await createTestUser();
    const assistantCoach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(creator.user.id);
    await addTeamMember(teamId, assistantCoach.user.id, "coach");
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await privateGroup(teamId, creator);

    const { error } = await assistantCoach.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: player.user.id });
    expect(error).toBeNull();
  });
});

// ── Read markers ──────────────────────────────────────────────────────────────

describe("chat read markers keep working, and cannot be used to join (BUG-003)", () => {
  it("a team member can upsert their read marker on the team channel", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await teamChannel(teamId);

    const { error } = await player.client
      .from("channel_members")
      .upsert(
        { channel_id: channelId, profile_id: player.user.id, last_read_at: new Date().toISOString() },
        { onConflict: "channel_id,profile_id" }
      );
    expect(error).toBeNull();
  });

  it("a group member can upsert their read marker on the group", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await privateGroup(teamId, coach, [player]);

    const { error } = await player.client
      .from("channel_members")
      .upsert(
        { channel_id: channelId, profile_id: player.user.id, last_read_at: new Date().toISOString() },
        { onConflict: "channel_id,profile_id" }
      );
    expect(error).toBeNull();
  });

  it("a member cannot re-point their team-channel read marker at a private group", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const teamChannelId = await teamChannel(teamId);
    await adminClient.from("channel_members").insert({ channel_id: teamChannelId, profile_id: player.user.id });
    const groupId = await privateGroup(teamId, coach);

    const { error } = await player.client
      .from("channel_members")
      .update({ channel_id: groupId })
      .eq("channel_id", teamChannelId)
      .eq("profile_id", player.user.id);
    expect(error).not.toBeNull();
    expect(await isGroupMember(groupId, player.user.id)).toBe(false);
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────

describe("messages can be soft-deleted but not edited (BUG-003)", () => {
  async function ownMessage() {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await teamChannel(teamId);
    const messageId = crypto.randomUUID();
    await adminClient
      .from("messages")
      .insert({ id: messageId, channel_id: channelId, sender_id: player.user.id, body: "Original" });
    return { coach, player, teamId, channelId, messageId };
  }

  async function stored(messageId: string) {
    const { data } = await adminClient.from("messages").select("*").eq("id", messageId).single();
    return data!;
  }

  it("a sender cannot edit their own message body", async () => {
    const { player, messageId } = await ownMessage();

    const { error } = await player.client.from("messages").update({ body: "Rewritten" }).eq("id", messageId);
    expect(error).not.toBeNull();
    expect((await stored(messageId)).body).toBe("Original");
  });

  // Moving into a channel the sender cannot read was already refused (the new row
  // fails the SELECT policy). Moving into one they can read — a group they belong
  // to — is still editing a sent message.
  it("a sender cannot move their message into another channel they belong to", async () => {
    const { coach, player, teamId, messageId } = await ownMessage();
    const groupId = await privateGroup(teamId, coach, [player]);

    const { error } = await player.client.from("messages").update({ channel_id: groupId }).eq("id", messageId);
    expect(error).not.toBeNull();
    expect((await stored(messageId)).channel_id).not.toBe(groupId);
  });

  it("a team admin cannot edit someone else's message body", async () => {
    const { coach, messageId } = await ownMessage();

    const { error } = await coach.client.from("messages").update({ body: "Moderated text" }).eq("id", messageId);
    expect(error).not.toBeNull();
    expect((await stored(messageId)).body).toBe("Original");
  });

  it("a soft-deleted message cannot be restored", async () => {
    const { player, messageId } = await ownMessage();
    const { error: deleteError } = await player.client
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);
    expect(deleteError).toBeNull();

    const { error } = await player.client.from("messages").update({ deleted_at: null }).eq("id", messageId);
    expect(error).not.toBeNull();
    expect((await stored(messageId)).deleted_at).not.toBeNull();
  });
});

// ── Removal ───────────────────────────────────────────────────────────────────

describe("removal from a team revokes its chat access (BUG-003)", () => {
  it("a removed creator can no longer see their group, rejoin it, or read it", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await privateGroup(teamId, player);
    await removeFromTeam(teamId, player);

    const { data: channels } = await player.client.from("channels").select("id").eq("id", channelId);
    expect(channels).toHaveLength(0);

    const { error } = await player.client
      .from("channel_members")
      .insert({ channel_id: channelId, profile_id: player.user.id });
    expect(error).not.toBeNull();

    const { data: messages } = await player.client.from("messages").select("id").eq("channel_id", channelId);
    expect(messages).toHaveLength(0);
  });

  it("a removed member can no longer see, read or send in their DMs from that team", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const dmId = await dm(teamId, coach, player);
    await removeFromTeam(teamId, player);

    const { data: channels } = await player.client.from("dm_channels").select("id").eq("id", dmId);
    expect(channels).toHaveLength(0);

    const { data: messages } = await player.client.from("messages").select("id").eq("dm_channel_id", dmId);
    expect(messages).toHaveLength(0);

    const { error } = await player.client
      .from("messages")
      .insert({ dm_channel_id: dmId, sender_id: player.user.id, body: "Still here?" });
    expect(error).not.toBeNull();
  });

  it("a removed parent keeps DM access while their child is still on the team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, parent.user.id, "player");
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, childId, "player");
    const dmId = await dm(teamId, coach, parent);
    await removeFromTeam(teamId, parent);

    const { data: messages } = await parent.client.from("messages").select("id").eq("dm_channel_id", dmId);
    expect(messages!.length).toBeGreaterThan(0);
  });

  it("the remaining participant keeps the conversation history", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const dmId = await dm(teamId, player, coach);
    await removeFromTeam(teamId, player);

    const { data: messages } = await coach.client.from("messages").select("id").eq("dm_channel_id", dmId);
    expect(messages!.length).toBeGreaterThan(0);
  });
});

// ── DM channels ───────────────────────────────────────────────────────────────

describe("DM channels: read markers only (BUG-003)", () => {
  it("a participant cannot re-point the conversation at someone else", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const other = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    await addTeamMember(teamId, other.user.id, "player");
    const dmId = await dm(teamId, coach, player);

    // Keep profile_a < profile_b (a CHECK constraint) so only the policy decides.
    const [profileA, profileB] = [coach.user.id, other.user.id].sort();
    const { error } = await coach.client
      .from("dm_channels")
      .update({ profile_a: profileA, profile_b: profileB })
      .eq("id", dmId);
    expect(error).not.toBeNull();

    const { data: after } = await adminClient.from("dm_channels").select("*").eq("id", dmId).single();
    expect([after!.profile_a, after!.profile_b]).toContain(player.user.id);
  });

  it("a participant can still update their read marker", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const dmId = await dm(teamId, coach, player);
    const { data: row } = await adminClient.from("dm_channels").select("profile_a").eq("id", dmId).single();
    const field = row!.profile_a === coach.user.id ? "last_read_a" : "last_read_b";

    const { error } = await coach.client
      .from("dm_channels")
      .update({ [field]: new Date().toISOString() })
      .eq("id", dmId);
    expect(error).toBeNull();
  });
});

// ── Helper exposure ───────────────────────────────────────────────────────────

describe("chat helpers do not leak team membership (BUG-003)", () => {
  it("profile_on_team is not callable from a client session", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await createTestUser().then((outsider) =>
      outsider.client.rpc("profile_on_team", { p_profile_id: player.user.id, p_team_id: teamId })
    );
    expect(error).not.toBeNull();
  });
});
