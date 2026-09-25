/**
 * Inviting and removing club directors (BUG-013, part 1).
 *
 * Club settings has shipped Invite director and Remove director controls whose
 * API routes never existed. Decisions (2026-09-24):
 *   - an invitation is emailed and becomes a directorship only when the
 *     recipient accepts it, signing up first if they need to
 *   - accepting adds the director to every active team in the club — the
 *     dashboard and club portal are reached through a team
 *   - removal is the owner's alone; the director's own teams pass to the owner,
 *     their `director` roster rows go, and any other role they hold stays
 *
 * The database does the checking and writing, in one transaction each:
 *   create_director_invitation, accept_invitation, remove_org_director. The
 *   first and last run as the service role only, with the caller's id passed
 *   in by the API route, like accept_invitation.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  archiveTeam,
  cleanupTestData,
  trackIds,
} from "./helpers";

afterAll(cleanupTestData);

/** A club with an owner and three teams: two active, one archived. */
async function setupClub() {
  const owner = await createTestUser();
  const { orgId, teamId: teamA } = await createTestTeam(owner.user.id);
  await addOrgMember(orgId, owner.user.id, "owner");

  const teamB = crypto.randomUUID();
  const archived = crypto.randomUUID();
  for (const [id, name] of [
    [teamB, "Team B"],
    [archived, "Old team"],
  ]) {
    const { error } = await adminClient
      .from("teams")
      .insert({ id, organization_id: orgId, name, owner_id: owner.user.id });
    if (error) throw new Error(error.message);
    trackIds({ teamId: id });
  }
  await archiveTeam(archived);

  return { owner, orgId, teamA, teamB, archived };
}

function invite(actorId: string, orgId: string, email: string) {
  return adminClient.rpc("create_director_invitation", {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_email: email,
  });
}

function accept(invitationId: string, userId: string, mode = "self") {
  return adminClient.rpc("accept_invitation", {
    p_invitation_id: invitationId,
    p_user_id: userId,
    p_mode: mode,
  });
}

function remove(actorId: string, orgId: string, profileId: string) {
  return adminClient.rpc("remove_org_director", {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_profile_id: profileId,
  });
}

/** A club with a director who has accepted an invitation. */
async function setupWithDirector() {
  const club = await setupClub();
  const director = await createTestUser();
  const { data, error } = await invite(club.owner.user.id, club.orgId, director.user.email);
  if (error) throw new Error(error.message);
  const { error: acceptError } = await accept(data.invitation_id, director.user.id);
  if (acceptError) throw new Error(acceptError.message);
  return { ...club, director };
}

async function orgRole(orgId: string, profileId: string) {
  const { data } = await adminClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return data?.role ?? null;
}

async function rosterRoles(profileId: string) {
  const { data } = await adminClient.from("team_members").select("team_id, role").eq("profile_id", profileId);
  return Object.fromEntries((data ?? []).map((r) => [r.team_id, r.role]));
}

async function activeTeam(profileId: string) {
  const { data } = await adminClient.from("profiles").select("active_team_id").eq("id", profileId).single();
  return data?.active_team_id ?? null;
}

// ── Inviting ──────────────────────────────────────────────────────────────────

describe("create_director_invitation", () => {
  it("the owner's invitation is a club invitation, with no team", async () => {
    const { owner, orgId } = await setupClub();

    const { data, error } = await invite(owner.user.id, orgId, "new.director@test.local");

    expect(error).toBeNull();
    expect(data.resent).toBe(false);
    const { data: row } = await adminClient.from("invitations").select("*").eq("id", data.invitation_id).single();
    expect(row).toMatchObject({
      role: "director",
      organization_id: orgId,
      team_id: null,
      email: "new.director@test.local",
      invited_by: owner.user.id,
      accepted_at: null,
    });
  });

  it("a director cannot invite: only the owner manages directors", async () => {
    const { orgId, director } = await setupWithDirector();

    const { error } = await invite(director.user.id, orgId, "someone@test.local");

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
  });

  it("refuses someone who is already the owner or a director", async () => {
    const { owner, orgId, director } = await setupWithDirector();

    const { error: again } = await invite(owner.user.id, orgId, director.user.email.toUpperCase());
    const { error: self } = await invite(owner.user.id, orgId, owner.user.email);

    expect(again?.message).toMatch(/ALREADY_MEMBER/);
    expect(self?.message).toMatch(/ALREADY_MEMBER/);
  });

  it("inviting the same address again reuses the pending invitation", async () => {
    const { owner, orgId } = await setupClub();

    const { data: first } = await invite(owner.user.id, orgId, "twice@test.local");
    const { data: second, error } = await invite(owner.user.id, orgId, " Twice@Test.local ");

    expect(error).toBeNull();
    expect(second.invitation_id).toBe(first.invitation_id);
    expect(second.resent).toBe(true);
  });

  it("clients cannot call the service functions directly", async () => {
    const { owner, orgId } = await setupClub();

    const { error: inviteError } = await owner.client.rpc("create_director_invitation", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_email: "x@test.local",
    });
    const { error: removeError } = await owner.client.rpc("remove_org_director", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_profile_id: owner.user.id,
    });

    expect(inviteError?.code).toBe("42501");
    expect(removeError?.code).toBe("42501");
  });

  it("a director invitation cannot also name a team", async () => {
    const { orgId, teamA } = await setupClub();

    const { error } = await adminClient.from("invitations").insert({
      email: "mixed@test.local",
      role: "director",
      organization_id: orgId,
      team_id: teamA,
    });

    expect(error?.message).toMatch(/invitations_scope_check/);
  });
});

// ── Accepting ─────────────────────────────────────────────────────────────────

describe("accepting a director invitation", () => {
  it("makes the recipient a director on every active team, and lands them in the club", async () => {
    const { orgId, teamA, teamB, archived, director } = await setupWithDirector();

    expect(await orgRole(orgId, director.user.id)).toBe("director");
    const roles = await rosterRoles(director.user.id);
    expect(roles[teamA]).toBe("director");
    expect(roles[teamB]).toBe("director");
    expect(roles[archived]).toBeUndefined();
    expect([teamA, teamB]).toContain(await activeTeam(director.user.id));
  });

  it("marks the invitation accepted, and a second acceptance is refused", async () => {
    const { owner, orgId } = await setupClub();
    const director = await createTestUser();
    const { data } = await invite(owner.user.id, orgId, director.user.email);

    expect((await accept(data.invitation_id, director.user.id)).error).toBeNull();
    const { error } = await accept(data.invitation_id, director.user.id);

    expect(error?.message).toMatch(/INVITATION_ALREADY_ACCEPTED/);
  });

  it("only the recipient can accept, and only as themselves", async () => {
    const { owner, orgId } = await setupClub();
    const intended = await createTestUser();
    const stranger = await createTestUser();
    const { data } = await invite(owner.user.id, orgId, intended.user.email);

    const { error: wrongPerson } = await accept(data.invitation_id, stranger.user.id);
    const { error: wrongMode } = await accept(data.invitation_id, intended.user.id, "guardian");

    expect(wrongPerson?.message).toMatch(/INVITATION_WRONG_RECIPIENT/);
    expect(wrongMode?.message).toMatch(/INVITATION_WRONG_TYPE/);
    expect(await orgRole(orgId, intended.user.id)).toBeNull();
  });

  it("keeps a role the recipient already holds on a team", async () => {
    const { owner, orgId, teamB } = await setupClub();
    const coach = await createTestUser();
    await addTeamMember(teamB, coach.user.id, "coach");
    const { data } = await invite(owner.user.id, orgId, coach.user.email);

    await accept(data.invitation_id, coach.user.id);

    expect((await rosterRoles(coach.user.id))[teamB]).toBe("coach");
  });

  it("the new director has club access through the database's own checks", async () => {
    const { orgId, director } = await setupWithDirector();

    const { data } = await director.client.from("organization_members").select("profile_id").eq("organization_id", orgId);

    expect(data?.length).toBe(2);
  });

  it("a team created later includes every director", async () => {
    const { owner, orgId, director } = await setupWithDirector();

    const { data: newTeam, error } = await owner.client.rpc("create_club_team", {
      org_id: orgId,
      team_name: "Team C",
      season: "",
    });
    expect(error).toBeNull();
    trackIds({ teamId: newTeam });

    expect((await rosterRoles(director.user.id))[newTeam]).toBe("director");
  });
});

// ── Removing ──────────────────────────────────────────────────────────────────

describe("remove_org_director", () => {
  it("only the owner can remove a director", async () => {
    const { orgId, director } = await setupWithDirector();
    const other = await createTestUser();
    await addOrgMember(orgId, other.user.id, "director");

    const { error } = await remove(director.user.id, orgId, other.user.id);

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
    expect(await orgRole(orgId, other.user.id)).toBe("director");
  });

  it("the owner cannot be removed this way", async () => {
    const { owner, orgId } = await setupClub();

    const { error } = await remove(owner.user.id, orgId, owner.user.id);

    expect(error?.message).toMatch(/NOT_A_DIRECTOR/);
    expect(await orgRole(orgId, owner.user.id)).toBe("owner");
  });

  it("removes the directorship and the director roster rows, and hands their teams to the owner", async () => {
    const { owner, orgId, teamA, teamB, director } = await setupWithDirector();
    // The director owns Team B, and coaches a team in another club.
    await adminClient.from("teams").update({ owner_id: director.user.id }).eq("id", teamB);
    const elsewhere = await createTestUser();
    const { teamId: otherClubTeam } = await createTestTeam(elsewhere.user.id);
    await addTeamMember(otherClubTeam, director.user.id, "coach");

    const { error } = await remove(owner.user.id, orgId, director.user.id);

    expect(error).toBeNull();
    expect(await orgRole(orgId, director.user.id)).toBeNull();
    const roles = await rosterRoles(director.user.id);
    expect(roles[teamA]).toBeUndefined();
    expect(roles[teamB]).toBeUndefined();
    expect(roles[otherClubTeam]).toBe("coach");
    const { data: b } = await adminClient.from("teams").select("owner_id").eq("id", teamB).single();
    expect(b?.owner_id).toBe(owner.user.id);
  });

  it("keeps any other role the director holds on the club's teams", async () => {
    const { owner, orgId, teamB } = await setupClub();
    const coach = await createTestUser();
    await addTeamMember(teamB, coach.user.id, "coach");
    const { data } = await invite(owner.user.id, orgId, coach.user.email);
    await accept(data.invitation_id, coach.user.id);

    await remove(owner.user.id, orgId, coach.user.id);

    expect((await rosterRoles(coach.user.id))[teamB]).toBe("coach");
  });

  it("clears an active team the director can no longer reach, and keeps one they can", async () => {
    const { owner, orgId, teamA, teamB } = await setupClub();
    const lost = await createTestUser();
    const kept = await createTestUser();
    await addTeamMember(teamB, kept.user.id, "coach");
    for (const person of [lost, kept]) {
      const { data } = await invite(owner.user.id, orgId, person.user.email);
      await accept(data.invitation_id, person.user.id);
    }
    await adminClient.from("profiles").update({ active_team_id: teamA }).eq("id", lost.user.id);
    await adminClient.from("profiles").update({ active_team_id: teamB }).eq("id", kept.user.id);

    await remove(owner.user.id, orgId, lost.user.id);
    await remove(owner.user.id, orgId, kept.user.id);

    expect(await activeTeam(lost.user.id)).toBeNull();
    expect(await activeTeam(kept.user.id)).toBe(teamB);
  });

  it("the removed director loses club access at once", async () => {
    const { owner, orgId, teamA, director } = await setupWithDirector();

    await remove(owner.user.id, orgId, director.user.id);

    const { data: members } = await director.client
      .from("organization_members")
      .select("profile_id")
      .eq("organization_id", orgId);
    const { data: events } = await director.client.from("events").select("id").eq("team_id", teamA);
    expect(members).toEqual([]);
    expect(events).toEqual([]);
    const { data: canAdmin } = await director.client.rpc("is_team_admin", { t_id: teamA });
    expect(canAdmin).toBe(false);
  });
});

