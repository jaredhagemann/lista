/**
 * Who a notification actually reaches (BUG-007, decision D2).
 *
 * The old fan-out asked the *caller's* client for recipients and preferences, so
 * other people's push tokens were invisible to it, and it treated the roster as
 * the audience — missing a guardian whose child is on the team but who has no
 * roster row of their own.
 *
 * Resolution now runs as the service role and is centred on the **adult who
 * receives**: a managed player resolves to their guardians, each adult's own
 * preferences decide, and an adult covering two children is told once.
 */

import { describe, it, expect, afterAll } from "vitest";
import { resolveRecipients } from "@/lib/notifications/recipients";
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

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function setPrefs(profileId: string, prefs: Record<string, boolean>) {
  const { error } = await adminClient
    .from("notification_preferences")
    .upsert({ profile_id: profileId, ...prefs }, { onConflict: "profile_id" });
  if (error) throw new Error(error.message);
}

async function addDevice(profileId: string, token: string) {
  const { error } = await adminClient
    .from("push_subscriptions")
    .insert({ profile_id: profileId, expo_push_token: token });
  if (error) throw new Error(error.message);
}

function forTeam(teamId: string, category: "event" | "chat" = "event") {
  return resolveRecipients(adminClient, { category, teamId });
}

async function setup() {
  const coach = await createTestUser();
  const { teamId, orgId } = await createTestTeam(coach.user.id);
  return { coach, teamId, orgId };
}

describe("resolving notification recipients (BUG-007, D2)", () => {
  it("reaches a teammate's own address and every device they have registered", async () => {
    const { coach, teamId } = await setup();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    await addDevice(player.user.id, "ExponentPushToken[phone]");
    await addDevice(player.user.id, "ExponentPushToken[tablet]");

    const recipients = await forTeam(teamId);

    const resolved = recipients.find((r) => r.profileId === player.user.id);
    expect(resolved).toBeDefined();
    expect(resolved!.emails).toEqual([player.user.email]);
    expect(resolved!.pushTargets).toHaveLength(2);
    expect(recipients.map((r) => r.profileId)).toContain(coach.user.id);
  });

  it("reaches a guardian who has no roster row of their own", async () => {
    const { teamId } = await setup();
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id, { relationship: "dad" });
    await addTeamMember(teamId, childId, "player");
    await addDevice(guardian.user.id, "ExponentPushToken[guardian]");

    const recipients = await forTeam(teamId);

    const resolved = recipients.find((r) => r.profileId === guardian.user.id);
    expect(resolved).toBeDefined();
    expect(resolved!.coversProfileIds).toContain(childId);
    expect(resolved!.pushTargets).toHaveLength(1);
    // The child has no inbox and no device; they are never a recipient themselves.
    expect(recipients.map((r) => r.profileId)).not.toContain(childId);
  });

  it("obeys the receiving adult's own preferences, not their child's", async () => {
    const { teamId } = await setup();
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, childId, "player");
    // The child's row says no; under D2 it no longer speaks for the adult.
    await setPrefs(childId, { email_enabled: false, push_enabled: false });

    const stillReached = (await forTeam(teamId)).find((r) => r.profileId === guardian.user.id);
    expect(stillReached!.emailEnabled).toBe(true);
    expect(stillReached!.pushEnabled).toBe(true);

    await setPrefs(guardian.user.id, { email_enabled: false, push_enabled: true });

    const afterOptOut = (await forTeam(teamId)).find((r) => r.profileId === guardian.user.id);
    expect(afterOptOut!.emailEnabled).toBe(false);
    expect(afterOptOut!.pushEnabled).toBe(true);
  });

  it("tells an adult once, however many of their children are on the team", async () => {
    const { teamId } = await setup();
    const guardian = await createTestUser();
    const first = await createManagedProfile(guardian.user.id, { firstName: "Zoey" });
    const second = await createManagedProfile(guardian.user.id, { firstName: "Robin" });
    await addTeamMember(teamId, first, "player");
    await addTeamMember(teamId, second, "player");

    const recipients = await forTeam(teamId);

    const forGuardian = recipients.filter((r) => r.profileId === guardian.user.id);
    expect(forGuardian).toHaveLength(1);
    expect(forGuardian[0].coversProfileIds.sort()).toEqual([first, second].sort());
  });

  it("does not notify an org director who is not on the team", async () => {
    const { teamId, orgId } = await setup();
    const director = await createTestUser();
    await addOrgMember(orgId, director.user.id, "director");

    const recipients = await forTeam(teamId);

    expect(recipients.map((r) => r.profileId)).not.toContain(director.user.id);
  });

  it("uses the chat preference for chat, and never emails a message", async () => {
    const { teamId } = await setup();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    await setPrefs(player.user.id, {
      email_enabled: true,
      push_enabled: true,
      chat_push_enabled: false,
    });

    const chat = (await forTeam(teamId, "chat")).find((r) => r.profileId === player.user.id);
    expect(chat!.pushEnabled).toBe(false);
    expect(chat!.emailEnabled).toBe(false);

    // The same person still gets event notifications: the categories are separate.
    const events = (await forTeam(teamId, "event")).find((r) => r.profileId === player.user.id);
    expect(events!.pushEnabled).toBe(true);
    expect(events!.emailEnabled).toBe(true);
  });

  it("resolves a named list of members, and leaves out the sender", async () => {
    const { coach, teamId } = await setup();
    const player = await createTestUser();
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    await addTeamMember(teamId, childId, "player");

    const recipients = await resolveRecipients(adminClient, {
      category: "chat",
      profileIds: [coach.user.id, player.user.id, childId],
      excludeProfileIds: [coach.user.id],
    });

    expect(recipients.map((r) => r.profileId).sort()).toEqual(
      [player.user.id, guardian.user.id].sort()
    );
  });
});
