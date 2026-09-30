/**
 * findClubTeam, the team /dashboard/club/open switches to (BUG-028 review).
 *
 * A deletion refusal links to the club an owner must hand over. Club pages pick
 * the club from the active team, so the route switches to one of the club's
 * teams the viewer is on. Run as the viewer, against real RLS: an owner or
 * director gets an unarchived team of that club; anyone else gets nothing.
 */

import { describe, it, expect, afterAll } from "vitest";
import { findClubTeam } from "@/lib/club/open";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  archiveTeam,
  setOrgPlan,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

async function addDirectorRow(teamId: string, profileId: string) {
  const { error } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, profile_id: profileId, role: "director" });
  if (error) throw new Error(`Failed to add director: ${error.message}`);
}

describe("findClubTeam", () => {
  it("finds the owner's team in the named club, not the other club they're on", async () => {
    const owner = await createTestUser();
    const other = await createTestTeam(owner.user.id); // another club: the active one, say
    const club = await createTestTeam(owner.user.id);
    await setOrgPlan(club.orgId);
    await addOrgMember(club.orgId, owner.user.id, "owner");
    await addOrgMember(other.orgId, owner.user.id, "owner");

    expect(await findClubTeam(owner.client as never, owner.user.id, club.orgId)).toBe(club.teamId);
    expect(await findClubTeam(owner.client as never, owner.user.id, other.orgId)).toBe(other.teamId);
  });

  it("finds a director through their director row, and skips archived teams", async () => {
    const coach = await createTestUser();
    const director = await createTestUser();
    const archived = await createTestTeam(coach.user.id);
    await setOrgPlan(archived.orgId);
    await addOrgMember(archived.orgId, director.user.id, "director");
    await addDirectorRow(archived.teamId, director.user.id);

    expect(await findClubTeam(director.client as never, director.user.id, archived.orgId)).toBe(archived.teamId);

    await archiveTeam(archived.teamId);
    expect(await findClubTeam(director.client as never, director.user.id, archived.orgId)).toBeNull();
  });

  it("finds nothing for a team member who doesn't run the club", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const club = await createTestTeam(coach.user.id);
    await setOrgPlan(club.orgId);
    await addTeamMember(club.teamId, player.user.id, "player");

    expect(await findClubTeam(player.client as never, player.user.id, club.orgId)).toBeNull();
  });
});
