/**
 * Accepting an invitation on the phone (BUG-011).
 *
 * The screen sent `self` for every invitation that was not a manager invite, so
 * a parent accepting their child's player invitation became the player.
 */

import { buildAcceptBody, inviteCopy } from "../lib/invite-accept";

const base = { isManagerInvite: false, identity: null, relationship: "" } as const;

describe("buildAcceptBody", () => {
  it("accepts a manage-an-existing-player invite without asking anything", () => {
    const result = buildAcceptBody({ ...base, isManagerInvite: true });

    expect(result).toEqual({ ok: true, body: { type: "manager" } });
  });

  it("refuses to guess when the person has not said who they are", () => {
    const result = buildAcceptBody(base);

    expect(result.ok).toBe(false);
    // The old screen sent { type: "self" } here, enrolling the parent as the player.
  });

  it("enrols the signed-in person when they are the player", () => {
    const result = buildAcceptBody({ ...base, identity: "self" });

    expect(result).toEqual({ ok: true, body: { type: "self" } });
  });

  it("asks a guardian for their relationship before sending anything", () => {
    const result = buildAcceptBody({ ...base, identity: "guardian" });

    expect(result.ok).toBe(false);
  });

  it("creates a new player for a guardian who names no existing child", () => {
    const result = buildAcceptBody({ ...base, identity: "guardian", relationship: "dad" });

    expect(result).toEqual({ ok: true, body: { type: "guardian", relationship: "dad" } });
  });

  it("joins a child the guardian already manages to the team", () => {
    const result = buildAcceptBody({
      ...base,
      identity: "guardian",
      relationship: "dad",
      existingChildId: "child-1",
    });

    expect(result).toEqual({
      ok: true,
      body: { type: "guardian", relationship: "dad", managedProfileId: "child-1" },
    });
  });

  it("omits the child id rather than sending an empty one", () => {
    const result = buildAcceptBody({
      ...base,
      identity: "guardian",
      relationship: "mom",
      existingChildId: "",
    });

    expect(result.ok && "managedProfileId" in result.body).toBe(false);
  });
});

// ── A club director invitation (BUG-029) ──────────────────────────────────────


describe("a director invitation", () => {
  const DIRECTOR = { role: "director", teamName: "SLOFC", isManagerInvite: false };

  it("accepts as the signed-in person, with nothing to answer", () => {
    const result = buildAcceptBody({ ...base, isDirectorInvite: true });

    expect(result).toEqual({ ok: true, body: { type: "self" } });
  });

  it("says it's to help run the club as a director, without team wording or an identity question", () => {
    const copy = inviteCopy(DIRECTOR);

    expect(copy.invitedAs).toBe("You've been invited to help run SLOFC as a director");
    expect(copy.roleLine).toBe("Help run SLOFC as a director");
    expect(copy.acceptLabel).toBe("Accept & join club");
    expect(copy.joined).toBe("You're now a director of SLOFC.");
    expect(copy.asksWhoYouAre).toBe(false);
  });
});

describe("other invitations keep their wording", () => {
  it("a team role, capitalized, and the identity question", () => {
    const copy = inviteCopy({ role: "player", teamName: "12U Girls", isManagerInvite: false });

    expect(copy.invitedAs).toBe("You've been invited as Player");
    expect(copy.roleLine).toBe("Role: Player");
    expect(copy.acceptLabel).toBe("Accept & join team");
    expect(copy.joined).toBe("You've joined 12U Girls.");
    expect(copy.asksWhoYouAre).toBe(true);
  });

  it("a guardian invitation: manage a player, no identity question", () => {
    const copy = inviteCopy({ role: "manager", teamName: "12U Girls", isManagerInvite: true });

    expect(copy.roleLine).toBe("You've been invited to manage a player on this team");
    expect(copy.acceptLabel).toBe("Accept & join team");
    expect(copy.asksWhoYouAre).toBe(false);
  });
});
