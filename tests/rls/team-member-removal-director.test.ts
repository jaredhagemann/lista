/**
 * BUG-046: removing a club owner or director from a team only changes their role.
 *
 * A person has one team_members row per team, so a director who coaches a team
 * holds a `coach` row there and nothing behind it. Deleting that row took the
 * team out of their app, though their directorship still gives them access.
 * Decisions (2026-11-05):
 *   - removing an owner's or director's coach, manager, player or parent row
 *     turns it into a `director` row; chat and availability are left alone
 *   - a `director` row can't be removed from a team: directors are removed in
 *     club settings
 *
 * remove_team_member_role makes the decision and the change in one
 * transaction, so a directorship removed meanwhile can't leave a stray row.
 */

import { describe, it, expect, afterAll } from "vitest";
import { isClubAdminOfTeam } from "@/lib/club/club-admin";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type Client = Awaited<ReturnType<typeof createTestUser>>["client"];

function removeRole(client: Client, memberId: string, teamId: string) {
  return client.rpc("remove_team_member_role", { p_member_id: memberId, p_team_id: teamId });
}

async function row(teamId: string, profileId: string) {
  const { data } = await adminClient
    .from("team_members")
    .select("id, role")
    .eq("team_id", teamId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return data as { id: string; role: string } | null;
}

/** A club with an owner who coaches team T, and a director who coaches it too. */
async function setupClub() {
  const owner = await createTestUser();
  const { orgId, teamId } = await createTestTeam(owner.user.id);
  await addOrgMember(orgId, owner.user.id, "owner");

  const director = await createTestUser();
  await addOrgMember(orgId, director.user.id, "director");
  await addTeamMember(teamId, director.user.id, "coach");

  return { owner, director, orgId, teamId };
}

describe("remove_team_member_role", () => {
  it("turns a coaching director's row into a director row", async () => {
    const { owner, director, teamId } = await setupClub();
    const before = (await row(teamId, director.user.id))!;

    const { data, error } = await removeRole(owner.client, before.id, teamId);

    expect(error).toBeNull();
    expect(data).toBe("kept_as_director");
    expect(await row(teamId, director.user.id)).toEqual({ id: before.id, role: "director" });
  });

  it("does the same for the club owner's row", async () => {
    const { owner, director, teamId } = await setupClub();
    const before = (await row(teamId, owner.user.id))!;

    const { data } = await removeRole(director.client, before.id, teamId);

    expect(data).toBe("kept_as_director");
    expect((await row(teamId, owner.user.id))!.role).toBe("director");
  });

  it("refuses a row that is already director, and leaves it", async () => {
    const { owner, director, teamId } = await setupClub();
    const before = (await row(teamId, director.user.id))!;
    await adminClient.from("team_members").update({ role: "director" }).eq("id", before.id);

    const { data } = await removeRole(owner.client, before.id, teamId);

    expect(data).toBe("director_row");
    expect((await row(teamId, director.user.id))!.role).toBe("director");
  });

  it("leaves a coach who isn't a club admin alone, for the caller to remove", async () => {
    const { owner, teamId } = await setupClub();
    const coach = await createTestUser();
    await addTeamMember(teamId, coach.user.id, "coach");
    const before = (await row(teamId, coach.user.id))!;

    const { data } = await removeRole(owner.client, before.id, teamId);

    expect(data).toBe("not_club_admin");
    expect((await row(teamId, coach.user.id))!.role).toBe("coach");
  });

  it("treats someone removed from the club as anyone else", async () => {
    const { owner, director, orgId, teamId } = await setupClub();
    const { error: removeError } = await adminClient.rpc("remove_org_director", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_profile_id: director.user.id,
    });
    expect(removeError).toBeNull();
    const before = (await row(teamId, director.user.id))!;

    const { data } = await removeRole(owner.client, before.id, teamId);

    expect(data).toBe("not_club_admin");
    expect((await row(teamId, director.user.id))!.role).toBe("coach");
  });

  it("only counts a directorship of this team's club", async () => {
    const { owner, teamId } = await setupClub();
    const elsewhere = await createTestUser();
    const { orgId: otherOrg } = await createTestTeam(elsewhere.user.id);
    await addOrgMember(otherOrg, elsewhere.user.id, "director");
    await addTeamMember(teamId, elsewhere.user.id, "coach");
    const before = (await row(teamId, elsewhere.user.id))!;

    const { data } = await removeRole(owner.client, before.id, teamId);

    expect(data).toBe("not_club_admin");
  });

  it("says when the row isn't on the team", async () => {
    const { owner, teamId } = await setupClub();

    const { data } = await removeRole(owner.client, crypto.randomUUID(), teamId);

    expect(data).toBe("not_found");
  });

  it("refuses a caller who can't run the team, and changes nothing", async () => {
    const { director, teamId } = await setupClub();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const before = (await row(teamId, director.user.id))!;

    const { error } = await removeRole(player.client, before.id, teamId);

    expect(error?.code).toBe("42501");
    expect((await row(teamId, director.user.id))!.role).toBe("coach");
  });
});

// ── Setting the director role on a team (BUG-046, 2026-11-05) ────────────────
//
// The roster's role editor offers Director for a club owner or director, so a
// coach can move them between director and a team role. Only they can hold a
// `director` row: the database refuses one for anyone else.

describe("the director role on a team", () => {
  async function setRole(client: Client, memberId: string, role: string) {
    return client.from("team_members").update({ role }).eq("id", memberId).select("role");
  }

  it("lets a coach set a club director's row to director, and back", async () => {
    const { director, teamId } = await setupClub();
    const coach = await createTestUser();
    await addTeamMember(teamId, coach.user.id, "coach");
    const target = (await row(teamId, director.user.id))!;

    const toDirector = await setRole(coach.client, target.id, "director");
    expect(toDirector.error).toBeNull();
    expect((await row(teamId, director.user.id))!.role).toBe("director");

    const toManager = await setRole(coach.client, target.id, "manager");
    expect(toManager.error).toBeNull();
    expect((await row(teamId, director.user.id))!.role).toBe("manager");
  });

  it("lets the club owner's row be set to director", async () => {
    const { owner, director, teamId } = await setupClub();
    const target = (await row(teamId, owner.user.id))!;

    const { error } = await setRole(director.client, target.id, "director");

    expect(error).toBeNull();
    expect((await row(teamId, owner.user.id))!.role).toBe("director");
  });

  it("refuses director for someone who isn't an owner or director of the club", async () => {
    const { owner, teamId } = await setupClub();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const target = (await row(teamId, player.user.id))!;

    const { error } = await setRole(owner.client, target.id, "director");

    expect(error?.code).toBe("42501");
    expect((await row(teamId, player.user.id))!.role).toBe("player");
  });

  it("refuses director for a director of another club", async () => {
    const { owner, teamId } = await setupClub();
    const elsewhere = await createTestUser();
    const { orgId: otherOrg } = await createTestTeam(elsewhere.user.id);
    await addOrgMember(otherOrg, elsewhere.user.id, "director");
    await addTeamMember(teamId, elsewhere.user.id, "coach");
    const target = (await row(teamId, elsewhere.user.id))!;

    const { error } = await setRole(owner.client, target.id, "director");

    expect(error?.code).toBe("42501");
    expect((await row(teamId, elsewhere.user.id))!.role).toBe("coach");
  });

  it("refuses a new director row for someone who isn't a club admin", async () => {
    const { teamId } = await setupClub();
    const outsider = await createTestUser();

    const { error } = await adminClient
      .from("team_members")
      .insert({ team_id: teamId, profile_id: outsider.user.id, role: "director" });

    expect(error?.code).toBe("42501");
    expect(await row(teamId, outsider.user.id)).toBeNull();
  });
});

// ── Who the role editor offers Director for ──────────────────────────────────

describe("isClubAdminOfTeam", () => {
  it("is true for the club's owner and directors, and false for anyone else", async () => {
    const { owner, director, teamId } = await setupClub();
    const coach = await createTestUser();
    await addTeamMember(teamId, coach.user.id, "coach");
    const elsewhere = await createTestUser();
    const { orgId: otherOrg } = await createTestTeam(elsewhere.user.id);
    await addOrgMember(otherOrg, elsewhere.user.id, "director");

    expect(await isClubAdminOfTeam(adminClient as never, teamId, owner.user.id)).toBe(true);
    expect(await isClubAdminOfTeam(adminClient as never, teamId, director.user.id)).toBe(true);
    expect(await isClubAdminOfTeam(adminClient as never, teamId, coach.user.id)).toBe(false);
    expect(await isClubAdminOfTeam(adminClient as never, teamId, elsewhere.user.id)).toBe(false);
  });
});
