/**
 * Guardians and the organizations they can see (BUG-021).
 *
 * A guardian's only link to a club-tier org is the managed child's team
 * membership. The "Orgs visible to members" policy used to require a profile
 * that was itself a member, so guardians read nothing — and the dashboard,
 * which takes the club subdomain and the training gate from that row, fell back
 * to the default Lista experience.
 *
 * Access must widen to guardians without widening to anyone else.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  createManagedProfile,
  setOrgPlan,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** A club-tier org with an active subdomain, and a team in it. */
async function createClubTeam(coach: TestUser) {
  const { orgId, teamId } = await createTestTeam(coach.user.id);
  await setOrgPlan(orgId, "club_large", "active");
  const subdomain = `club-${orgId.slice(0, 8)}`;
  const { error } = await adminClient
    .from("organizations")
    .update({ subdomain, subdomain_status: "active" })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
  return { orgId, teamId, subdomain };
}

/**
 * The production shape: the child holds the membership and has no sign-in of
 * their own; the guardian has no membership at all.
 */
async function createGuardianOfPlayer(teamId: string) {
  const guardian = await createTestUser();
  const childId = await createManagedProfile(guardian.user.id, { relationship: "dad" });
  await addTeamMember(teamId, childId, "player");
  await adminClient.from("profiles").update({ active_team_id: teamId }).eq("id", guardian.user.id);
  return { guardian, childId };
}

function readOrg(client: TestUser["client"], orgId: string) {
  return client
    .from("organizations")
    .select("id, plan, subdomain, subdomain_status, subscription_status")
    .eq("id", orgId)
    .maybeSingle();
}

describe("guardians can see their child's organization (BUG-021)", () => {
  it("a guardian reads the club org behind their child's team", async () => {
    const coach = await createTestUser();
    const { orgId, teamId, subdomain } = await createClubTeam(coach);
    const { guardian } = await createGuardianOfPlayer(teamId);

    const { data } = await readOrg(guardian.client, orgId);

    expect(data).not.toBeNull();
    expect(data!.plan).toBe("club_large");
    expect(data!.subdomain).toBe(subdomain);
    expect(data!.subdomain_status).toBe("active");
  });

  it("the dashboard resolves the club subdomain for that guardian", async () => {
    const coach = await createTestUser();
    const { orgId, teamId, subdomain } = await createClubTeam(coach);
    const { guardian } = await createGuardianOfPlayer(teamId);
    const db = guardian.client;

    // Replays apps/web/src/app/dashboard/layout.tsx: own profile, managed
    // profiles, memberships across both, then the org behind the active team.
    const { data: ownProfile } = await db
      .from("profiles")
      .select("*")
      .eq("id", guardian.user.id)
      .single();
    const { data: managedLinks } = await db
      .from("profile_managers")
      .select("managed_id")
      .eq("manager_id", guardian.user.id)
      .neq("managed_id", guardian.user.id);
    const allProfileIds = [guardian.user.id, ...(managedLinks ?? []).map((l) => l.managed_id)];
    const { data: allMemberships } = await db
      .from("team_members")
      .select("*, teams(*)")
      .in("profile_id", allProfileIds)
      .order("created_at");

    const activeMembership =
      allMemberships!.find(
        (m) => m.profile_id === guardian.user.id && m.team_id === ownProfile!.active_team_id
      ) ??
      allMemberships!.find((m) => m.profile_id === guardian.user.id) ??
      allMemberships![0] ??
      null;
    const activeOrgId =
      (activeMembership?.teams as { organization_id?: string | null } | null)?.organization_id ??
      null;
    expect(activeOrgId).toBe(orgId);

    const { data: orgData } = await db
      .from("organizations")
      .select("subdomain, subdomain_status, plan, subscription_status")
      .eq("id", activeOrgId!)
      .maybeSingle();

    // What layout.tsx computes from that row.
    const activeOrgSubdomain =
      orgData && ["club_small", "club_large"].includes(orgData.plan ?? "") &&
      orgData.subdomain_status === "active"
        ? orgData.subdomain
        : null;
    const hasTrainingAccess =
      ["club_small", "club_large"].includes(orgData?.plan ?? "") &&
      ["trialing", "active", "past_due"].includes(orgData?.subscription_status ?? "");

    expect(activeOrgSubdomain).toBe(subdomain);
    expect(hasTrainingAccess).toBe(true);
  });

  it("a guardian gains no access to an org they have no child on", async () => {
    const coach = await createTestUser();
    const { teamId } = await createClubTeam(coach);
    const { guardian } = await createGuardianOfPlayer(teamId);

    const otherCoach = await createTestUser();
    const { orgId: otherOrgId } = await createClubTeam(otherCoach);

    const { data } = await readOrg(guardian.client, otherOrgId);
    expect(data).toBeNull();
  });

  it("a signed-in outsider still cannot read the org", async () => {
    const coach = await createTestUser();
    const { orgId } = await createClubTeam(coach);
    const outsider = await createTestUser();

    const { data } = await readOrg(outsider.client, orgId);
    expect(data).toBeNull();
  });

  it("team members and org members still read their own org", async () => {
    const coach = await createTestUser();
    const { orgId, teamId } = await createClubTeam(coach);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const director = await createTestUser();
    await addOrgMember(orgId, director.user.id, "director");

    expect((await readOrg(coach.client, orgId)).data).not.toBeNull();
    expect((await readOrg(player.client, orgId)).data).not.toBeNull();
    expect((await readOrg(director.client, orgId)).data).not.toBeNull();
  });
});
