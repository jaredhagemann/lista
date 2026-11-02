import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  createManagedProfile,
  addOrgMember,
  addTeamMember,
  setOrgPlan,
  trackIds,
  cleanupTestData,
} from "./helpers";

describe("profiles RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("user can see own profile", async () => {
    const { client, user } = await createTestUser();

    const { data, error } = await client
      .from("profiles")
      .select()
      .eq("id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("user can see teammate profiles", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await coach.client
      .from("profiles")
      .select()
      .eq("id", player.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("user cannot see non-teammate profiles", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    // No shared team

    const { data, error } = await user1.client
      .from("profiles")
      .select()
      .eq("id", user2.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user can update own profile", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client
      .from("profiles")
      .update({ first_name: "Updated" })
      .eq("id", user.id);
    expect(error).toBeNull();

    const { data } = await client.from("profiles").select().eq("id", user.id);
    expect(data![0].first_name).toBe("Updated");
  });

  it("user cannot update another user's profile", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    // Make them teammates so user1 can see user2
    const { teamId } = await createTestTeam(user1.user.id);
    await addTeamMember(teamId, user2.user.id, "player");

    await user1.client
      .from("profiles")
      .update({ first_name: "Hacked" })
      .eq("id", user2.user.id);
    // RLS blocks — no error but no rows updated
    const { data } = await user2.client.from("profiles").select().eq("id", user2.user.id);
    expect(data![0].first_name).not.toBe("Hacked");
  });

  it("user can update birthday and gender", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client
      .from("profiles")
      .update({ birthday: "2010-05-15", gender: "female" })
      .eq("id", user.id);
    expect(error).toBeNull();

    const { data } = await client.from("profiles").select().eq("id", user.id);
    expect(data![0].birthday).toBe("2010-05-15");
    expect(data![0].gender).toBe("female");
  });
});

/**
 * Who can read personal details, by direct query on the base table (BUG-004, D8).
 * The privacy page says the same, and tests/privacy-page.test.tsx holds it to this.
 */
describe("who can read a profile's personal details", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  type Client = Awaited<ReturnType<typeof createTestUser>>["client"];

  /** The details a reader gets for a profile, or null when the row isn't visible. */
  async function details(reader: Client, profileId: string) {
    const { data, error } = await reader
      .from("profiles")
      .select("email, birthday, gender")
      .eq("id", profileId)
      .maybeSingle();
    expect(error).toBeNull();
    return data;
  }

  /** A guardian's phone number, read directly, or null when the link isn't visible. */
  async function phone(reader: Client, managedId: string) {
    const { data, error } = await reader.from("profile_managers").select("phone").eq("managed_id", managedId).maybeSingle();
    expect(error).toBeNull();
    return data?.phone ?? null;
  }

  /** A club with two teams: a player and a guardian's child on A, a clubmate on B. */
  async function club() {
    const coach = await createTestUser();
    const { orgId, teamId: teamA } = await createTestTeam(coach.user.id);
    await setOrgPlan(orgId);
    const teamB = crypto.randomUUID();
    const { error } = await adminClient
      .from("teams")
      .insert({ id: teamB, organization_id: orgId, name: "Team B", owner_id: coach.user.id });
    if (error) throw new Error(error.message);
    trackIds({ teamId: teamB });

    const player = await createTestUser();
    await addTeamMember(teamA, player.user.id, "player");
    const clubmate = await createTestUser();
    await addTeamMember(teamB, clubmate.user.id, "player");
    const director = await createTestUser();
    await addOrgMember(orgId, director.user.id, "director");
    const guardian = await createTestUser();
    const child = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamA, child, "player");

    const { error: detailsError } = await adminClient
      .from("profiles")
      .update({ birthday: "2015-03-14", gender: "female" })
      .in("id", [player.user.id, child]);
    if (detailsError) throw new Error(detailsError.message);

    const { error: phoneError } = await adminClient
      .from("profile_managers")
      .update({ phone: "555-0100" })
      .eq("managed_id", child);
    if (phoneError) throw new Error(phoneError.message);

    return { coach, player, clubmate, director, guardian, child };
  }

  it("you read your own", async () => {
    const { player } = await club();

    expect(await details(player.client, player.user.id)).toEqual({
      email: player.user.email,
      birthday: "2015-03-14",
      gender: "female",
    });
  });

  it("a teammate reads your email, date of birth and gender", async () => {
    const { coach, player } = await club();

    expect(await details(coach.client, player.user.id)).toEqual({
      email: player.user.email,
      birthday: "2015-03-14",
      gender: "female",
    });
  });

  it("a teammate reads a managed child's details", async () => {
    const { player, child } = await club();

    expect((await details(player.client, child))?.birthday).toBe("2015-03-14");
  });

  it("a player's guardian reads their child's teammates' details", async () => {
    const { guardian, player } = await club();

    expect((await details(guardian.client, player.user.id))?.birthday).toBe("2015-03-14");
  });

  it("a guardian reads their own child's details", async () => {
    const { guardian, child } = await club();

    expect((await details(guardian.client, child))?.birthday).toBe("2015-03-14");
  });

  it("a team's coach reads a guardian's profile and phone, though the guardian isn't on the team", async () => {
    const { coach, guardian, child } = await club();

    expect((await details(coach.client, guardian.user.id))?.email).toBe(guardian.user.email);
    expect(await phone(coach.client, child)).toBe("555-0100");
  });

  // The link between guardian and child is hidden from them by profile_managers' own
  // RLS. They see a guardian's contact details on the team page, which reads them with
  // the service role. BUG-041 asks whether the profile itself should stay hidden.
  it("a player, another guardian and a club director don't read the guardian's profile directly", async () => {
    const { player, director, guardian, child } = await club();
    const otherGuardian = await createTestUser();
    const otherChild = await createManagedProfile(otherGuardian.user.id);
    const { data: membership } = await adminClient
      .from("team_members")
      .select("team_id")
      .eq("profile_id", player.user.id)
      .single();
    await addTeamMember(membership!.team_id, otherChild, "player");

    for (const reader of [player, otherGuardian, director]) {
      expect(await details(reader.client, guardian.user.id)).toBeNull();
      expect(await phone(reader.client, child)).toBeNull();
    }
  });

  it("a club director reads the details of anyone on the club's teams", async () => {
    const { director, player, clubmate, child } = await club();

    expect((await details(director.client, player.user.id))?.birthday).toBe("2015-03-14");
    expect(await details(director.client, clubmate.user.id)).not.toBeNull();
    expect((await details(director.client, child))?.birthday).toBe("2015-03-14");
  });

  // D8: the case that must not silently widen.
  it("a clubmate on another team reads nothing", async () => {
    const { clubmate, player, child, guardian } = await club();

    expect(await details(clubmate.client, player.user.id)).toBeNull();
    expect(await details(clubmate.client, child)).toBeNull();
    expect(await details(clubmate.client, guardian.user.id)).toBeNull();
    expect(await phone(clubmate.client, child)).toBeNull();
  });

  it("someone outside the team and club reads nothing", async () => {
    const { player, child, guardian } = await club();
    const outsider = await createTestUser();

    expect(await details(outsider.client, player.user.id)).toBeNull();
    expect(await details(outsider.client, child)).toBeNull();
    expect(await details(outsider.client, guardian.user.id)).toBeNull();
    expect(await phone(outsider.client, child)).toBeNull();
  });
});
