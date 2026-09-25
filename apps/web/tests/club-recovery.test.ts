/**
 * Support's club-ownership recovery (BUG-013, part 2).
 *
 * When a club's owner has lost access, support moves ownership to a director
 * (docs/runbooks/club-owner-recovery.md). Decisions (2026-09-24): the request
 * comes from a current director, who confirms the club's Stripe billing details;
 * there is no waiting period; the old owner's address is told at once.
 *
 * recoverClubOwnership is what the script runs: it finds the director by email,
 * moves ownership in the database (recover_club_ownership), then moves Stripe's
 * billing email and sends the notice, as an accepted transfer does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: null as { id: string } | null,
  rpc: vi.fn(),
  applyOwnershipChange: vi.fn(async () => ({ billingEmailUpdated: true, noticeSent: true })),
}));

vi.mock("@/lib/club/ownership", () => ({ applyOwnershipChange: mocks.applyOwnershipChange }));

import { recoverClubOwnership } from "@/lib/club/recovery";

const admin = {
  from: () => ({
    select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }),
  }),
  rpc: mocks.rpc,
} as unknown as Parameters<typeof recoverClubOwnership>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { id: "director-1" };
  mocks.rpc.mockResolvedValue({ data: { transfer_id: "t-1", previous_owner_id: "owner-1" }, error: null });
});

describe("recoverClubOwnership", () => {
  it("moves ownership to the director, then updates billing and tells the old owner", async () => {
    const result = await recoverClubOwnership(admin, {
      orgId: "org-1",
      toEmail: " Director@Test.local ",
      reason: "Owner lost their email; director confirmed card ending 4242",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("recover_club_ownership", {
      p_org_id: "org-1",
      p_to_profile_id: "director-1",
      p_reason: "Owner lost their email; director confirmed card ending 4242",
    });
    expect(mocks.applyOwnershipChange).toHaveBeenCalledWith(admin, {
      orgId: "org-1",
      newOwnerId: "director-1",
      previousOwnerId: "owner-1",
      how: "recovered",
    });
    expect(result).toEqual({ transferId: "t-1", previousOwnerId: "owner-1", billingEmailUpdated: true, noticeSent: true });
  });

  it("refuses an address with no Lista account, before changing anything", async () => {
    mocks.profile = null;

    await expect(
      recoverClubOwnership(admin, { orgId: "org-1", toEmail: "nobody@test.local", reason: "x" })
    ).rejects.toThrow(/no Lista account/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason for the record", async () => {
    await expect(recoverClubOwnership(admin, { orgId: "org-1", toEmail: "d@test.local", reason: "  " })).rejects.toThrow(
      /reason/i
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the database's refusal through, and sends nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOT_A_DIRECTOR: ownership can only go to a director of this club" } });

    await expect(
      recoverClubOwnership(admin, { orgId: "org-1", toEmail: "d@test.local", reason: "lost access" })
    ).rejects.toThrow(/NOT_A_DIRECTOR/);
    expect(mocks.applyOwnershipChange).not.toHaveBeenCalled();
  });
});
