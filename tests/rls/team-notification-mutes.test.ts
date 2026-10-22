/**
 * Team mutes (docs/specs/team-notification-controls.md §3.2).
 *
 * A mute belongs to the adult who receives the notices: they manage their own
 * rows, for teams they reach as a member or through a managed player. A
 * managed player has no inbox, so no row can name one. The team's coaches and
 * managers can read the team's mutes but not change them (D4).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";
import { collectTeamDeletionRecipients } from "@/lib/notifications/team-deletion";

afterAll(cleanupTestData);

async function setup() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  const player = await createTestUser();
  await addTeamMember(teamId, player.user.id, "player");
  return { coach, teamId, player };
}

async function seedMute(profileId: string, teamId: string) {
  const { error } = await adminClient
    .from("team_notification_mutes")
    .insert({ profile_id: profileId, team_id: teamId });
  if (error) throw new Error(error.message);
}

async function mutesFor(profileId: string, teamId: string) {
  const { data } = await adminClient
    .from("team_notification_mutes")
    .select("*")
    .eq("profile_id", profileId)
    .eq("team_id", teamId);
  return data ?? [];
}

describe("team_notification_mutes RLS", () => {
  it("a member can mute their own team, and the row mutes email and push by default", async () => {
    const { teamId, player } = await setup();

    const { error } = await player.client
      .from("team_notification_mutes")
      .insert({ profile_id: player.user.id, team_id: teamId });
    expect(error).toBeNull();

    const rows = await mutesFor(player.user.id, teamId);
    expect(rows).toHaveLength(1);
    expect(rows[0].email_muted).toBe(true);
    expect(rows[0].push_muted).toBe(true);
  });

  it("a member can read, update and delete their own mute", async () => {
    const { teamId, player } = await setup();
    await seedMute(player.user.id, teamId);

    const { data: read } = await player.client
      .from("team_notification_mutes")
      .select("*")
      .eq("team_id", teamId);
    expect(read).toHaveLength(1);

    const { error: updateError } = await player.client
      .from("team_notification_mutes")
      .update({ push_muted: false })
      .eq("profile_id", player.user.id)
      .eq("team_id", teamId);
    expect(updateError).toBeNull();
    expect((await mutesFor(player.user.id, teamId))[0].push_muted).toBe(false);

    const { error: deleteError } = await player.client
      .from("team_notification_mutes")
      .delete()
      .eq("profile_id", player.user.id)
      .eq("team_id", teamId);
    expect(deleteError).toBeNull();
    expect(await mutesFor(player.user.id, teamId)).toHaveLength(0);
  });

  it("a member can't create, see, change or remove a teammate's mute", async () => {
    const { teamId, player } = await setup();
    const teammate = await createTestUser();
    await addTeamMember(teamId, teammate.user.id, "player");

    const { error: insertError } = await player.client
      .from("team_notification_mutes")
      .insert({ profile_id: teammate.user.id, team_id: teamId });
    expect(insertError).not.toBeNull();

    await seedMute(teammate.user.id, teamId);

    const { data: read } = await player.client
      .from("team_notification_mutes")
      .select("*")
      .eq("profile_id", teammate.user.id);
    expect(read).toHaveLength(0);

    await player.client
      .from("team_notification_mutes")
      .update({ email_muted: false })
      .eq("profile_id", teammate.user.id);
    await player.client.from("team_notification_mutes").delete().eq("profile_id", teammate.user.id);

    const rows = await mutesFor(teammate.user.id, teamId);
    expect(rows).toHaveLength(1);
    expect(rows[0].email_muted).toBe(true);
  });

  it("a guardian can mute a team they reach only through a managed player", async () => {
    const { teamId } = await setup();
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, childId, "player");

    const { error } = await guardian.client
      .from("team_notification_mutes")
      .insert({ profile_id: guardian.user.id, team_id: teamId });
    expect(error).toBeNull();
  });

  it("no one can mute a team they don't reach", async () => {
    const { teamId } = await setup();
    const outsider = await createTestUser();

    const { error } = await outsider.client
      .from("team_notification_mutes")
      .insert({ profile_id: outsider.user.id, team_id: teamId });
    expect(error).not.toBeNull();
  });

  it("a member can't move their mute to a team they don't reach", async () => {
    const { teamId, player } = await setup();
    const otherCoach = await createTestUser();
    const { teamId: otherTeamId } = await createTestTeam(otherCoach.user.id);
    await seedMute(player.user.id, teamId);

    await player.client
      .from("team_notification_mutes")
      .update({ team_id: otherTeamId })
      .eq("profile_id", player.user.id)
      .eq("team_id", teamId);

    expect(await mutesFor(player.user.id, otherTeamId)).toHaveLength(0);
    expect(await mutesFor(player.user.id, teamId)).toHaveLength(1);
  });

  it("no row can name a managed player, even from their guardian", async () => {
    const { teamId } = await setup();
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, childId, "player");

    const { error } = await guardian.client
      .from("team_notification_mutes")
      .insert({ profile_id: childId, team_id: teamId });
    expect(error).not.toBeNull();
  });

  it("the team's coach can read its mutes but can't change or remove them (D4)", async () => {
    const { coach, teamId, player } = await setup();
    await seedMute(player.user.id, teamId);

    const { data: read, error } = await coach.client
      .from("team_notification_mutes")
      .select("*")
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(read!.map((r) => r.profile_id)).toContain(player.user.id);

    await coach.client
      .from("team_notification_mutes")
      .update({ email_muted: false })
      .eq("profile_id", player.user.id);
    await coach.client.from("team_notification_mutes").delete().eq("profile_id", player.user.id);

    const rows = await mutesFor(player.user.id, teamId);
    expect(rows).toHaveLength(1);
    expect(rows[0].email_muted).toBe(true);
  });

  it("the team's manager can read its mutes too", async () => {
    const { teamId, player } = await setup();
    const manager = await createTestUser();
    await addTeamMember(teamId, manager.user.id, "manager");
    await seedMute(player.user.id, teamId);

    const { data } = await manager.client
      .from("team_notification_mutes")
      .select("*")
      .eq("team_id", teamId);
    expect(data!.map((r) => r.profile_id)).toContain(player.user.id);
  });

  it("a parent on the team, or another team's coach, can't read its mutes", async () => {
    const { teamId, player } = await setup();
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "parent");
    const otherCoach = await createTestUser();
    await createTestTeam(otherCoach.user.id);
    await seedMute(player.user.id, teamId);

    for (const reader of [parent, otherCoach]) {
      const { data } = await reader.client
        .from("team_notification_mutes")
        .select("*")
        .eq("team_id", teamId);
      expect(data).toHaveLength(0);
    }
  });

  it("a team can be muted once per person", async () => {
    const { teamId, player } = await setup();
    await seedMute(player.user.id, teamId);

    const { error } = await player.client
      .from("team_notification_mutes")
      .insert({ profile_id: player.user.id, team_id: teamId });
    expect(error).not.toBeNull();
  });
});

describe("notices a mute never covers (D3)", () => {
  it("someone who muted the team is still told it was deleted", async () => {
    const { teamId, player } = await setup();
    await seedMute(player.user.id, teamId);

    const recipients = await collectTeamDeletionRecipients(teamId, "Test Team");

    expect(recipients.emails).toContain(player.user.email);
  });
});
