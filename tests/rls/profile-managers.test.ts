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

describe("profile_managers RLS", () => {
  it("manager can view their own managed profiles", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data, error } = await parent.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].managed_id).toBe(managedId);
  });

  it("user cannot view another user's managed profiles", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data } = await stranger.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(data).toHaveLength(0);
  });

  it("team admin can view managed profiles for members of their team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const { data } = await coach.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(data).toHaveLength(1);
  });
});

describe("managed profiles: profiles RLS", () => {
  it("manager can read their managed profile", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data, error } = await parent.client
      .from("profiles")
      .select("id, first_name")
      .eq("id", managedId)
      .single();

    expect(error).toBeNull();
    expect(data!.id).toBe(managedId);
  });

  it("stranger cannot read a managed profile they don't manage", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data } = await stranger.client
      .from("profiles")
      .select("id")
      .eq("id", managedId);

    expect(data).toHaveLength(0);
  });

  it("manager can update their managed profile", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id, { firstName: "Before" });

    const { error } = await parent.client
      .from("profiles")
      .update({ first_name: "After" })
      .eq("id", managedId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", managedId)
      .single();
    expect(data!.first_name).toBe("After");
  });

  it("stranger cannot update a managed profile they don't manage", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    await stranger.client
      .from("profiles")
      .update({ first_name: "Hacked" })
      .eq("id", managedId);

    // RLS blocks the update — no error, but 0 rows affected
    const { data } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", managedId)
      .single();
    expect(data!.first_name).not.toBe("Hacked");
  });

  it("teammates can see a managed profile on their team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const { data } = await coach.client
      .from("profiles")
      .select("id")
      .eq("id", managedId);

    expect(data).toHaveLength(1);
  });
});

describe("managed profiles: availability RLS", () => {
  it("manager can insert availability for a managed profile", async () => {
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    // Create an event
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: parent.user.id,
    });

    const { error } = await parent.client.from("availability").insert({
      event_id: eventId,
      profile_id: managedId,
      status: "available",
    });

    expect(error).toBeNull();
  });

  it("non-manager cannot insert availability for someone else's managed profile", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    await addTeamMember(teamId, stranger.user.id, "player");
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event 2",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: parent.user.id,
    });

    const { error } = await stranger.client.from("availability").insert({
      event_id: eventId,
      profile_id: managedId,
      status: "available",
    });

    expect(error).not.toBeNull();
  });
});

describe("is_team_member extended for managed profiles", () => {
  it("parent can see events on a team their managed profile is on", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");
    // Parent is NOT directly on the team

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Managed Profile Team Event",
      event_type: "game",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: coach.user.id,
    });

    const { data } = await parent.client
      .from("events")
      .select("id")
      .eq("id", eventId);

    expect(data).toHaveLength(1);
  });

  it("stranger cannot see events on a team only accessible via managed profiles", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Private Team Event",
      event_type: "game",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: coach.user.id,
    });

    const { data } = await stranger.client
      .from("events")
      .select("id")
      .eq("id", eventId);

    expect(data).toHaveLength(0);
  });
});

describe("team_members: inserting managed profiles", () => {
  it("team admin can add their own managed profile to their team", async () => {
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });

    expect(error).toBeNull();
  });

  it("non-admin cannot add another user's managed profile to a team", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id); // coach is admin, not stranger
    await addTeamMember(teamId, stranger.user.id, "player"); // stranger is just a player
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await stranger.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });

    expect(error).not.toBeNull();
  });

  // BUG-001: a guardian could add their managed child to any team and, through
  // is_team_member's manager branch, read that team's data. Managed profiles are
  // free to create, so this was self-admission by another route.
  it("guardian who is not a team member cannot add their managed child to that team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });
    expect(error).not.toBeNull();

    const { data: visible } = await parent.client
      .from("team_members")
      .select()
      .eq("team_id", teamId);
    expect(visible).toHaveLength(0);
  });

  it("guardian who is only a player on a team cannot add their managed child to it", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, parent.user.id, "player");
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });
    expect(error).not.toBeNull();
  });
});

// ── BUG-002 ───────────────────────────────────────────────────────────────────
// Guardian links (profile_managers) must come from an authorized path (D1), and
// every player without their own login must keep a guardian who has one.

async function linkGuardian(managerId: string, managedId: string) {
  const { data, error } = await adminClient
    .from("profile_managers")
    .insert({ manager_id: managerId, managed_id: managedId, relationship: "Guardian" })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to link guardian: ${error.message}`);
  return data.id as string;
}

async function guardianLinks(managedId: string) {
  const { data } = await adminClient
    .from("profile_managers")
    .select("id, manager_id")
    .eq("managed_id", managedId)
    .neq("manager_id", managedId);
  return data ?? [];
}

describe("profile_managers: claiming profiles (BUG-002)", () => {
  it("outsider cannot claim an existing child and then edit them", async () => {
    const parent = await createTestUser();
    const outsider = await createTestUser();
    const childId = await createManagedProfile(parent.user.id, { firstName: "Original" });

    const { error } = await outsider.client
      .from("profile_managers")
      .insert({ manager_id: outsider.user.id, managed_id: childId });
    expect(error).not.toBeNull();

    await outsider.client.from("profiles").update({ first_name: "Hijacked" }).eq("id", childId);
    const { data: child } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", childId)
      .single();
    expect(child!.first_name).toBe("Original");
    expect((await guardianLinks(childId)).map((l) => l.manager_id)).toEqual([parent.user.id]);
  });

  it("outsider cannot claim another adult account profile", async () => {
    const victim = await createTestUser();
    const outsider = await createTestUser();

    const { error } = await outsider.client
      .from("profile_managers")
      .insert({ manager_id: outsider.user.id, managed_id: victim.user.id });
    expect(error).not.toBeNull();
  });
});

describe("profiles: identity fields are locked for client sessions (BUG-002)", () => {
  it("guardian cannot change a managed child email", async () => {
    const parent = await createTestUser();
    const childId = await createManagedProfile(parent.user.id);
    const { data: before } = await adminClient.from("profiles").select("email").eq("id", childId).single();

    const { error } = await parent.client
      .from("profiles")
      .update({ email: "attacker@test.local" })
      .eq("id", childId);
    expect(error).not.toBeNull();

    const { data: after } = await adminClient.from("profiles").select("email").eq("id", childId).single();
    expect(after!.email).toBe(before!.email);
  });

  it("guardian cannot detach the login of a player who has their own account", async () => {
    const teen = await createTestUser();
    const parent = await createTestUser();
    await linkGuardian(parent.user.id, teen.user.id);

    const { error } = await parent.client
      .from("profiles")
      .update({ auth_user_id: null })
      .eq("id", teen.user.id);
    expect(error).not.toBeNull();

    const { data } = await adminClient.from("profiles").select("auth_user_id").eq("id", teen.user.id).single();
    expect(data!.auth_user_id).toBe(teen.user.id);
  });

  it("user cannot change their own profile email from a client session", async () => {
    const user = await createTestUser();

    const { error } = await user.client
      .from("profiles")
      .update({ email: "changed@test.local" })
      .eq("id", user.user.id);
    expect(error).not.toBeNull();

    const { data } = await adminClient.from("profiles").select("email").eq("id", user.user.id).single();
    expect(data!.email).toBe(user.user.email);
  });

  it("guardian can still edit a managed child name, birthday and gender", async () => {
    const parent = await createTestUser();
    const childId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client
      .from("profiles")
      .update({ first_name: "Renamed", birthday: "2015-04-01", gender: "female" })
      .eq("id", childId);
    expect(error).toBeNull();
  });
});

describe("profile_managers: every player keeps a login path (BUG-002, D1/D7)", () => {
  it("sole guardian cannot remove their link to a child with no login", async () => {
    const parent = await createTestUser();
    const childId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client
      .from("profile_managers")
      .delete()
      .eq("manager_id", parent.user.id)
      .eq("managed_id", childId);
    expect(error).not.toBeNull();
    expect(await guardianLinks(childId)).toHaveLength(1);
  });

  it("a pending guardian invitation does not count as a replacement", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, childId, "player");
    const { error: inviteError } = await adminClient.from("invitations").insert({
      team_id: teamId,
      email: `pending-${crypto.randomUUID()}@test.local`,
      role: "manager",
      managed_profile_id: childId,
    });
    expect(inviteError).toBeNull();

    const { error } = await parent.client
      .from("profile_managers")
      .delete()
      .eq("manager_id", parent.user.id)
      .eq("managed_id", childId);
    expect(error).not.toBeNull();
    expect(await guardianLinks(childId)).toHaveLength(1);
  });

  it("guardian can remove their link when another guardian with a login remains", async () => {
    const parent1 = await createTestUser();
    const parent2 = await createTestUser();
    const childId = await createManagedProfile(parent1.user.id);
    await linkGuardian(parent2.user.id, childId);

    const { error } = await parent1.client
      .from("profile_managers")
      .delete()
      .eq("manager_id", parent1.user.id)
      .eq("managed_id", childId);
    expect(error).toBeNull();
    expect((await guardianLinks(childId)).map((l) => l.manager_id)).toEqual([parent2.user.id]);
  });

  it("guardian can remove their link to a player who has their own login", async () => {
    const teen = await createTestUser();
    const parent = await createTestUser();
    await linkGuardian(parent.user.id, teen.user.id);

    const { error } = await parent.client
      .from("profile_managers")
      .delete()
      .eq("manager_id", parent.user.id)
      .eq("managed_id", teen.user.id);
    expect(error).toBeNull();
    expect(await guardianLinks(teen.user.id)).toHaveLength(0);
  });

  it("concurrent removal by both guardians leaves exactly one guardian", async () => {
    const parent1 = await createTestUser();
    const parent2 = await createTestUser();
    const childId = await createManagedProfile(parent1.user.id);
    await linkGuardian(parent2.user.id, childId);
    const links = await guardianLinks(childId);
    expect(links).toHaveLength(2);

    // Service role: the invariant must hold on privileged paths too.
    const results = await Promise.all(
      links.map((l) => adminClient.from("profile_managers").delete().eq("id", l.id))
    );

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(await guardianLinks(childId)).toHaveLength(1);
  });

  it("deleting the child profile itself still removes its guardian links", async () => {
    const parent = await createTestUser();
    const childId = await createManagedProfile(parent.user.id);

    const { error } = await adminClient.from("profiles").delete().eq("id", childId);
    expect(error).toBeNull();
    expect(await guardianLinks(childId)).toHaveLength(0);
  });

  it("a sole guardian account cannot be deleted while their child has no other login path", async () => {
    const parent = await createTestUser();
    await createManagedProfile(parent.user.id);

    const { error } = await adminClient.auth.admin.deleteUser(parent.user.id);
    expect(error).not.toBeNull();

    const { data } = await adminClient.from("profiles").select("id").eq("id", parent.user.id).maybeSingle();
    expect(data).not.toBeNull();
  });

  it("guardian_dependents lists only players who would lose their last login path", async () => {
    const parent = await createTestUser();
    const coParent = await createTestUser();
    const teen = await createTestUser();
    const soleChildId = await createManagedProfile(parent.user.id, { firstName: "Sole" });
    const sharedChildId = await createManagedProfile(parent.user.id, { firstName: "Shared" });
    await linkGuardian(coParent.user.id, sharedChildId);
    await linkGuardian(parent.user.id, teen.user.id);

    const { data, error } = await adminClient.rpc("guardian_dependents", {
      p_manager_id: parent.user.id,
    });
    expect(error).toBeNull();
    expect((data as Array<{ profile_id: string }>).map((d) => d.profile_id)).toEqual([soleChildId]);
  });

  it("guardian_dependents is not callable from a client session", async () => {
    const parent = await createTestUser();

    const { error } = await parent.client.rpc("guardian_dependents", {
      p_manager_id: parent.user.id,
    });
    expect(error).not.toBeNull();
  });
});
