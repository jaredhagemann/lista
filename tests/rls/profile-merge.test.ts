/**
 * Merging two records of the same child (BUG-011, historical repair).
 *
 * D6 ruled historical repair out of scope on the understanding that no duplicate
 * identities existed. A production check on 2026-09-18 found one: the same child
 * held two profiles, each carrying real history — a team, availability responses,
 * training sessions and guardian links split between them.
 *
 * merge_managed_profiles moves everything onto the surviving profile and deletes
 * the other, in one transaction. It refuses anything that is not a managed
 * profile: a person with their own login owns their account, and no merge tool
 * gets to delete it.
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

afterAll(cleanupTestData);

const DAY_MS = 24 * 60 * 60 * 1000;

async function createEvent(teamId: string, coachId: string) {
  const id = crypto.randomUUID();
  const start = new Date(Date.now() + 3 * DAY_MS);
  const { error } = await adminClient.from("events").insert({
    id,
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 3600_000).toISOString(),
    created_by: coachId,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function respond(eventId: string, profileId: string, status = "available") {
  const { error } = await adminClient
    .from("availability")
    .insert({ event_id: eventId, profile_id: profileId, status });
  if (error) throw new Error(error.message);
}

async function logTraining(profileId: string, teamId: string, loggedBy: string) {
  const { data: category } = await adminClient
    .from("training_categories")
    .select("id")
    .eq("team_id", teamId)
    .limit(1)
    .maybeSingle();

  const { error } = await adminClient.from("training_sessions").insert({
    profile_id: profileId,
    team_id: teamId,
    category_id: category?.id ?? null,
    session_date: new Date().toISOString().slice(0, 10),
    duration_minutes: 30,
    created_by: loggedBy,
  });
  if (error) throw new Error(error.message);
}

async function counts(profileId: string) {
  const [memberships, availability, training, guardians] = await Promise.all([
    adminClient.from("team_members").select("team_id").eq("profile_id", profileId),
    adminClient.from("availability").select("id").eq("profile_id", profileId),
    adminClient.from("training_sessions").select("id").eq("profile_id", profileId),
    adminClient.from("profile_managers").select("manager_id").eq("managed_id", profileId),
  ]);
  return {
    teams: (memberships.data ?? []).map((m) => m.team_id),
    availability: (availability.data ?? []).length,
    training: (training.data ?? []).length,
    guardians: (guardians.data ?? []).length,
  };
}

async function exists(profileId: string) {
  const { data } = await adminClient.from("profiles").select("id").eq("id", profileId).maybeSingle();
  return data !== null;
}

describe("merge_managed_profiles (BUG-011)", () => {
  it("moves teams, responses, training and guardians onto the surviving record", async () => {
    const coach = await createTestUser();
    const mum = await createTestUser();
    const dad = await createTestUser();
    const { teamId: clubTeam } = await createTestTeam(coach.user.id);
    const { teamId: futsalTeam } = await createTestTeam(coach.user.id);

    // The record the live team points at.
    const keep = await createManagedProfile(mum.user.id, { firstName: "Finley" });
    await addTeamMember(clubTeam, keep, "player");
    await respond(await createEvent(clubTeam, coach.user.id), keep);
    await logTraining(keep, clubTeam, mum.user.id);

    // The older record, on another team, with both parents linked.
    const merge = await createManagedProfile(dad.user.id, { firstName: "Finley" });
    await adminClient
      .from("profile_managers")
      .insert({ manager_id: mum.user.id, managed_id: merge, relationship: "mom" });
    await addTeamMember(futsalTeam, merge, "player");
    await respond(await createEvent(futsalTeam, coach.user.id), merge);
    await respond(await createEvent(futsalTeam, coach.user.id), merge);

    const { error } = await adminClient.rpc("merge_managed_profiles", {
      p_keep: keep,
      p_merge: merge,
    });
    expect(error).toBeNull();

    const after = await counts(keep);
    expect(after.teams.sort()).toEqual([clubTeam, futsalTeam].sort());
    expect(after.availability).toBe(3);
    expect(after.training).toBe(1);
    expect(after.guardians).toBe(2);
    expect(await exists(merge)).toBe(false);
  });

  it("carries invitations across, rather than being blocked by them", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const keep = await createManagedProfile(guardian.user.id, { firstName: "Finley" });
    const merge = await createManagedProfile(guardian.user.id, { firstName: "Finley" });
    await addTeamMember(teamId, merge, "player");

    // A guardian invitation naming the record about to be merged away. The
    // invitations foreign key does not cascade, so this blocked the delete
    // outright in production on 2026-09-18.
    const invitationId = crypto.randomUUID();
    const { error: inviteError } = await adminClient.from("invitations").insert({
      id: invitationId,
      team_id: teamId,
      email: "other-parent@example.com",
      role: "manager",
      managed_profile_id: merge,
      relationship: "mom",
      invited_by: coach.user.id,
    });
    if (inviteError) throw new Error(inviteError.message);

    const { error } = await adminClient.rpc("merge_managed_profiles", {
      p_keep: keep,
      p_merge: merge,
    });
    expect(error).toBeNull();

    const { data: invitation } = await adminClient
      .from("invitations")
      .select("managed_profile_id")
      .eq("id", invitationId)
      .single();
    expect(invitation!.managed_profile_id).toBe(keep);
    expect(await exists(merge)).toBe(false);
  });

  it("fills in details the survivor was missing", async () => {
    const guardian = await createTestUser();
    const keep = await createManagedProfile(guardian.user.id, { firstName: "Finley" });
    const merge = await createManagedProfile(guardian.user.id, { firstName: "Finley" });
    await adminClient
      .from("profiles")
      .update({ birthday: "2018-03-25", gender: "female" })
      .eq("id", merge);

    await adminClient.rpc("merge_managed_profiles", { p_keep: keep, p_merge: merge });

    const { data: survivor } = await adminClient
      .from("profiles")
      .select("birthday, gender")
      .eq("id", keep)
      .single();
    expect(survivor!.birthday).toBe("2018-03-25");
    expect(survivor!.gender).toBe("female");
  });

  it("keeps one row where both records held the same thing", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const keep = await createManagedProfile(guardian.user.id);
    const merge = await createManagedProfile(guardian.user.id);

    // Both records on the same team, both answering the same event.
    await addTeamMember(teamId, keep, "player");
    await addTeamMember(teamId, merge, "player");
    const eventId = await createEvent(teamId, coach.user.id);
    await respond(eventId, keep, "available");
    await respond(eventId, merge, "maybe");

    const { error } = await adminClient.rpc("merge_managed_profiles", {
      p_keep: keep,
      p_merge: merge,
    });
    expect(error).toBeNull();

    const after = await counts(keep);
    expect(after.teams).toEqual([teamId]);
    expect(after.availability).toBe(1);
    // The survivor's own answer stands; the duplicate is dropped, not applied.
    const { data: response } = await adminClient
      .from("availability")
      .select("status")
      .eq("event_id", eventId)
      .single();
    expect(response!.status).toBe("available");
  });

  it("refuses to merge a profile that has its own login", async () => {
    const guardian = await createTestUser();
    const person = await createTestUser();
    const managed = await createManagedProfile(guardian.user.id);

    const intoPerson = await adminClient.rpc("merge_managed_profiles", {
      p_keep: person.user.id,
      p_merge: managed,
    });
    expect(intoPerson.error).not.toBeNull();

    const fromPerson = await adminClient.rpc("merge_managed_profiles", {
      p_keep: managed,
      p_merge: person.user.id,
    });
    expect(fromPerson.error).not.toBeNull();

    expect(await exists(person.user.id)).toBe(true);
    expect(await exists(managed)).toBe(true);
  });

  it("refuses to merge a record into itself", async () => {
    const guardian = await createTestUser();
    const managed = await createManagedProfile(guardian.user.id);

    const { error } = await adminClient.rpc("merge_managed_profiles", {
      p_keep: managed,
      p_merge: managed,
    });
    expect(error).not.toBeNull();
    expect(await exists(managed)).toBe(true);
  });

  it("is not callable by a signed-in user", async () => {
    const guardian = await createTestUser();
    const keep = await createManagedProfile(guardian.user.id);
    const merge = await createManagedProfile(guardian.user.id);

    const { error } = await guardian.client.rpc("merge_managed_profiles", {
      p_keep: keep,
      p_merge: merge,
    });
    expect(error).not.toBeNull();
    expect(await exists(merge)).toBe(true);
  });
});
