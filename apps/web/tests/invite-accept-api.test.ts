/**
 * POST /api/invite/[id]/accept — how the phone accepts an invitation (BUG-011).
 *
 * The route only understood "self" and "manager", so a parent accepting their
 * child's player invitation from the native app could only be enrolled as the
 * player. It now takes "guardian" as well, with the relationship and, when the
 * guardian says so, the child they already manage.
 *
 * The acceptance itself is mocked here; its rules are tested against a real
 * database in tests/rls/invitation-identity.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "guardian-1" } as { id: string } | null,
  acceptInvitation: vi.fn(async () => ({
    ok: true as const,
    teamId: "team-1",
    teamMemberId: "member-1",
    managedProfileId: "child-1",
  })),
}));

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: async () => mocks.user,
  adminClient: () => ({}),
}));
vi.mock("@/lib/invitations/accept", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations/accept")>()),
  acceptInvitation: mocks.acceptInvitation,
}));

import { POST } from "@/app/api/invite/[id]/accept/route";

function accept(body: unknown) {
  return POST(
    new Request("https://lista.team/api/invite/inv-1/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer mobile-jwt" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "inv-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "guardian-1" };
});

describe("accepting as a guardian", () => {
  it("passes the relationship and the named child through", async () => {
    const response = await accept({
      type: "guardian",
      relationship: "dad",
      managedProfileId: "child-1",
    });

    expect(response.status).toBe(200);
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(expect.anything(), {
      invitationId: "inv-1",
      userId: "guardian-1",
      mode: "guardian",
      relationship: "dad",
      firstName: undefined,
      lastName: undefined,
      managedProfileId: "child-1",
    });
  });

  it("creates a new player when no child is named", async () => {
    await accept({ type: "guardian", relationship: "mom" });

    expect(mocks.acceptInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "guardian", managedProfileId: undefined })
    );
  });

  it("insists on a relationship", async () => {
    const response = await accept({ type: "guardian" });

    expect(response.status).toBe(400);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("reports a child the caller does not manage as forbidden", async () => {
    mocks.acceptInvitation.mockResolvedValueOnce({
      ok: false,
      reason: "not_your_child",
      message: "You don't manage that player",
    } as never);

    const response = await accept({
      type: "guardian",
      relationship: "dad",
      managedProfileId: "someone-elses-child",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "You don't manage that player" });
  });
});

describe("the other acceptance modes still work", () => {
  it("accepts the player themselves", async () => {
    const response = await accept({ type: "self" });

    expect(response.status).toBe(200);
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "self" })
    );
  });

  it("accepts a manage-an-existing-player invitation", async () => {
    const response = await accept({ type: "manager" });

    expect(response.status).toBe(200);
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "manager" })
    );
  });

  it("refuses a mode it does not know", async () => {
    const response = await accept({ type: "owner" });

    expect(response.status).toBe(400);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    mocks.user = null;

    const response = await accept({ type: "self" });

    expect(response.status).toBe(401);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });
});
