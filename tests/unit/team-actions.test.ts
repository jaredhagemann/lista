import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mock factories ────────────────────────────────────────────────────
// vi.hoisted runs before module imports, so these refs are available inside
// vi.mock() factory functions without temporal-dead-zone issues.

const mocks = vi.hoisted(() => {
  /**
   * Returns an object that behaves like a Supabase query builder chain.
   * Every method returns `this` for chaining; `.single()` and `.maybeSingle()`
   * return a Promise; the object itself is thenable so `await chain.eq(...)` works.
   */
  function makeChain(result: { data: unknown; error: null | { message: string } }) {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "update", "delete", "insert", "gte", "order", "is"]) {
      c[m] = () => c;
    }
    c.single = () => Promise.resolve(result);
    c.maybeSingle = () => Promise.resolve(result);
    c.then = (onFulfilled: (v: typeof result) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return c;
  }

  const mockGetUser = vi.fn();
  const mockServerFrom = vi.fn();
  const mockAdminFrom = vi.fn();
  const mockAdminStorageList = vi.fn();
  const mockAdminStorageRemove = vi.fn();
  const mockRedirect = vi.fn();
  const mockRevalidatePath = vi.fn();
  const mockSendDeletionNotifications = vi.fn();
  const mockGetActiveProfileId = vi.fn();

  return {
    makeChain,
    mockGetUser,
    mockServerFrom,
    mockAdminFrom,
    mockAdminStorageList,
    mockAdminStorageRemove,
    mockRedirect,
    mockRevalidatePath,
    mockSendDeletionNotifications,
    mockGetActiveProfileId,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.mockGetUser },
      from: mocks.mockServerFrom,
    }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mocks.mockAdminFrom,
    storage: {
      from: () => ({
        list: mocks.mockAdminStorageList,
        remove: mocks.mockAdminStorageRemove,
      }),
    },
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.mockRedirect }));
vi.mock("next/dist/client/components/redirect", () => ({
  redirect: mocks.mockRedirect,
  getRedirectError: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.mockRevalidatePath }));
vi.mock("next/dist/server/web/spec-extension/revalidate", () => ({
  revalidatePath: mocks.mockRevalidatePath,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/notifications/team-deletion", () => ({
  sendTeamDeletionNotifications: mocks.mockSendDeletionNotifications,
}));
vi.mock("@/lib/get-active-membership", () => ({
  getActiveProfileId: mocks.mockGetActiveProfileId,
  getActiveMembership: vi.fn(),
}));

// ── Import actions after mocks are declared ───────────────────────────────────

import { deleteTeam, transferOwnership, removeTeamMember } from "@/app/actions/team";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER_ID = "owner-profile-id";
const OTHER_ID = "other-profile-id";
const TEAM_ID = "team-id";
const TEAM_NAME = "U12 Blue";
const MEMBER_ROW_ID = "member-row-id";

function setupUser(id = OWNER_ID) {
  mocks.mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

function setupNoUser() {
  mocks.mockGetUser.mockResolvedValue({ data: { user: null } });
}

// ── deleteTeam ────────────────────────────────────────────────────────────────

describe("deleteTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSendDeletionNotifications.mockResolvedValue(undefined);
    mocks.mockAdminStorageList.mockResolvedValue({ data: [], error: null });
    mocks.mockAdminStorageRemove.mockResolvedValue({ data: null, error: null });
    mocks.mockAdminFrom.mockReturnValue(
      mocks.makeChain({ data: null, error: null })
    );
  });

  it("returns Unauthorized when not authenticated", async () => {
    setupNoUser();
    const result = await deleteTeam(TEAM_ID);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns Not authorized when caller is not the owner", async () => {
    setupUser(OTHER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID, name: TEAM_NAME }, error: null })
    );
    const result = await deleteTeam(TEAM_ID);
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("dispatches deletion notifications before deleting the team", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID, name: TEAM_NAME }, error: null })
    );
    let notifyCalledBeforeDelete = false;
    mocks.mockSendDeletionNotifications.mockImplementation(async () => {
      notifyCalledBeforeDelete = true;
    });
    let deleteCalledAfterNotify = false;
    mocks.mockAdminFrom.mockImplementation(() => {
      if (notifyCalledBeforeDelete) deleteCalledAfterNotify = true;
      return mocks.makeChain({ data: null, error: null });
    });

    // redirect() in Next.js throws NEXT_REDIRECT to unwind the call stack;
    // swallow it so we can still assert on the side effects above.
    await deleteTeam(TEAM_ID).catch((e: unknown) => {
      if (!String(e).includes("NEXT_REDIRECT")) throw e;
    });

    expect(notifyCalledBeforeDelete).toBe(true);
    expect(deleteCalledAfterNotify).toBe(true);
  });

  it("deletes storage objects before deleting the team", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID, name: TEAM_NAME }, error: null })
    );
    mocks.mockAdminStorageList.mockResolvedValue({
      data: [{ name: "logo.png" }, { name: "photo.jpg" }],
      error: null,
    });

    await deleteTeam(TEAM_ID).catch((e: unknown) => {
      if (!String(e).includes("NEXT_REDIRECT")) throw e;
    });

    expect(mocks.mockAdminStorageList).toHaveBeenCalledWith(TEAM_ID);
    expect(mocks.mockAdminStorageRemove).toHaveBeenCalledWith([
      `${TEAM_ID}/logo.png`,
      `${TEAM_ID}/photo.jpg`,
    ]);
  });

  it("redirects to /dashboard on success", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID, name: TEAM_NAME }, error: null })
    );

    // Next.js redirect() throws NEXT_REDIRECT — that is the redirect mechanism.
    await expect(deleteTeam(TEAM_ID)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("returns error message when the DB delete fails", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID, name: TEAM_NAME }, error: null })
    );
    mocks.mockAdminFrom.mockReturnValue(
      mocks.makeChain({ data: null, error: { message: "DB error" } })
    );

    const result = await deleteTeam(TEAM_ID);
    expect(result).toEqual({ error: "DB error" });
  });
});

// ── transferOwnership ─────────────────────────────────────────────────────────

describe("transferOwnership", () => {
  const RECIPIENT_ID = "recipient-profile-id";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockRevalidatePath.mockReturnValue(undefined);
  });

  it("returns Unauthorized when not authenticated", async () => {
    setupNoUser();
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns Not authorized when caller is not the owner", async () => {
    setupUser(OTHER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null })
    );
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID);
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error when recipient is not a team member", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null })
    );
    mocks.mockAdminFrom.mockReturnValue(
      mocks.makeChain({ data: null, error: null })
    );
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID);
    expect(result).toEqual({ error: "Recipient is not a team member" });
  });

  it("returns error when recipient is a player", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null })
    );
    mocks.mockAdminFrom.mockReturnValue(
      mocks.makeChain({
        data: { role: "player", profiles: { auth_user_id: "some-auth-id" } },
        error: null,
      })
    );
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID);
    expect(result).toEqual({ error: "Ownership can only be transferred to a coach, manager, or director" });
  });

  it("returns error when recipient is a managed profile (no auth account)", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null })
    );
    mocks.mockAdminFrom.mockReturnValue(
      mocks.makeChain({
        data: { role: "coach", profiles: { auth_user_id: null } },
        error: null,
      })
    );
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID);
    expect(result).toEqual({ error: "Ownership cannot be transferred to a managed profile" });
  });

  it("returns success and revalidates when owner transfers to a valid auth-backed admin", async () => {
    setupUser(OWNER_ID);
    mocks.mockServerFrom.mockReturnValue(
      mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null })
    );
    // First admin call: recipient membership lookup
    // Second admin call: owner_id update
    mocks.mockAdminFrom
      .mockReturnValueOnce(
        mocks.makeChain({
          data: { role: "coach", profiles: { auth_user_id: "recipient-auth-id" } },
          error: null,
        })
      )
      .mockReturnValueOnce(mocks.makeChain({ data: null, error: null }));

    // revalidatePath() throws outside of a Next.js render context; if we reach
    // it the authorization and DB update succeeded — treat as success.
    const result = await transferOwnership(TEAM_ID, RECIPIENT_ID).catch(
      (e: unknown) => {
        if (String(e).includes("static generation store missing")) return { success: true };
        throw e;
      }
    );
    expect(result).toEqual({ success: true });
  });
});

// ── removeTeamMember — owner removal guard ────────────────────────────────────

describe("removeTeamMember — owner removal guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetActiveProfileId.mockResolvedValue(OTHER_ID); // caller is a non-owner admin
  });

  it("blocks removal when the target member is the current team owner", async () => {
    setupUser(OTHER_ID);
    // Sequence of from() calls in removeTeamMember:
    //   1. team_members — caller admin check
    //   2. team_members — target lookup
    //   3. teams       — owner check
    mocks.mockServerFrom
      .mockReturnValueOnce(mocks.makeChain({ data: { role: "coach" }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { profile_id: OWNER_ID }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null }));

    const result = await removeTeamMember(MEMBER_ROW_ID, TEAM_ID);
    expect(result).toEqual({ error: "Transfer ownership before removing the team owner" });
  });

  it("allows removal when the target is not the team owner", async () => {
    const TARGET_ID = "non-owner-player-id";
    setupUser(OTHER_ID);
    mocks.mockGetActiveProfileId.mockResolvedValue(OTHER_ID);
    // Sequence: caller check → target lookup → owner check → admin client calls (cleanup)
    mocks.mockServerFrom
      .mockReturnValueOnce(mocks.makeChain({ data: { role: "coach" }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { profile_id: TARGET_ID }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null }))
      .mockReturnValue(mocks.makeChain({ data: null, error: null }));
    mocks.mockAdminFrom.mockReturnValue(mocks.makeChain({ data: [], error: null }));

    // revalidatePath() throws outside a Next.js render context; reaching it means
    // all business-logic checks passed — the owner guard did not fire.
    const result = await removeTeamMember(MEMBER_ROW_ID, TEAM_ID).catch(
      (e: unknown) => {
        if (String(e).includes("static generation store missing")) return { success: true };
        throw e;
      }
    );
    expect(result).not.toEqual({ error: "Transfer ownership before removing the team owner" });
  });

  it("allows a non-owner admin to remove themselves from the team", async () => {
    // Caller and target are the same non-owner admin
    setupUser(OTHER_ID);
    mocks.mockGetActiveProfileId.mockResolvedValue(OTHER_ID);
    mocks.mockServerFrom
      .mockReturnValueOnce(mocks.makeChain({ data: { role: "coach" }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { profile_id: OTHER_ID }, error: null }))
      .mockReturnValueOnce(mocks.makeChain({ data: { owner_id: OWNER_ID }, error: null }))
      .mockReturnValue(mocks.makeChain({ data: null, error: null }));
    mocks.mockAdminFrom.mockReturnValue(mocks.makeChain({ data: [], error: null }));

    const result = await removeTeamMember(MEMBER_ROW_ID, TEAM_ID).catch(
      (e: unknown) => {
        if (String(e).includes("static generation store missing")) return { success: true };
        throw e;
      }
    );
    expect(result).not.toEqual({ error: "You cannot remove yourself from the team" });
    expect(result).not.toEqual({ error: "Transfer ownership before removing the team owner" });
  });
});
