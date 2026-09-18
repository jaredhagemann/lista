/**
 * Accepting an invitation on the phone (BUG-011).
 *
 * The screen sent `self` for every invitation that was not a manager invite, so
 * a parent accepting their child's player invitation became the player.
 */

import { buildAcceptBody } from "../lib/invite-accept";

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
