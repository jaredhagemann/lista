/**
 * Club ownership: transfer, recovery, and never ownerless (BUG-013, part 2).
 *
 * An owner could delete their account — or their own owner row — and leave an
 * active club with nobody responsible for it. Decisions (2026-09-24):
 *   - ownership goes only to an existing director, who must accept; one pending
 *     transfer at a time, cancellable by the owner, expiring after 14 days
 *   - the previous owner becomes a director
 *   - support can move ownership to a director when the owner has lost access
 *     (recover_club_ownership), recorded like any transfer
 *   - an open club always has an owner: the database refuses, at commit, any
 *     change that would leave one without — account deletion included
 *
 * The transfer functions run as the service role only, with the acting user's
 * id passed in by the API route.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addOrgMember,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

async function setupClub() {
  const owner = await createTestUser();
  const director = await createTestUser();
  const { orgId, teamId } = await createTestTeam(owner.user.id);
  await addOrgMember(orgId, owner.user.id, "owner");
  await addOrgMember(orgId, director.user.id, "director");
  return { owner, director, orgId, teamId };
}

function start(actorId: string, orgId: string, toId: string) {
  return adminClient.rpc("start_ownership_transfer", {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_to_profile_id: toId,
  });
}

function respond(actorId: string, transferId: string, accept: boolean) {
  return adminClient.rpc("respond_ownership_transfer", {
    p_actor_id: actorId,
    p_transfer_id: transferId,
    p_accept: accept,
  });
}

function cancel(actorId: string, transferId: string) {
  return adminClient.rpc("cancel_ownership_transfer", {
    p_actor_id: actorId,
    p_transfer_id: transferId,
  });
}

async function roles(orgId: string) {
  const { data } = await adminClient
    .from("organization_members")
    .select("profile_id, role")
    .eq("organization_id", orgId);
  return Object.fromEntries((data ?? []).map((r) => [r.profile_id, r.role]));
}

async function transfer(id: string) {
  const { data } = await adminClient.from("organization_ownership_transfers").select("*").eq("id", id).single();
  return data!;
}

// ── Starting ──────────────────────────────────────────────────────────────────

describe("start_ownership_transfer", () => {
  it("the owner offers ownership to a director, pending for 14 days", async () => {
    const { owner, director, orgId } = await setupClub();

    const { data: id, error } = await start(owner.user.id, orgId, director.user.id);

    expect(error).toBeNull();
    const row = await transfer(id);
    expect(row).toMatchObject({
      organization_id: orgId,
      from_profile_id: owner.user.id,
      to_profile_id: director.user.id,
      status: "pending",
    });
    const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86_400_000;
    expect(days).toBeCloseTo(14, 1);
    // Nothing changes until the director accepts.
    expect((await roles(orgId))[owner.user.id]).toBe("owner");
  });

  it("only the owner can start one", async () => {
    const { director, orgId } = await setupClub();
    const other = await createTestUser();
    await addOrgMember(orgId, other.user.id, "director");

    const { error } = await start(director.user.id, orgId, other.user.id);

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
  });

  it("only to a director of this club", async () => {
    const { owner, orgId } = await setupClub();
    const outsider = await createTestUser();

    const { error: toOutsider } = await start(owner.user.id, orgId, outsider.user.id);
    const { error: toSelf } = await start(owner.user.id, orgId, owner.user.id);

    expect(toOutsider?.message).toMatch(/NOT_A_DIRECTOR/);
    expect(toSelf?.message).toMatch(/NOT_A_DIRECTOR/);
  });

  it("one pending transfer at a time", async () => {
    const { owner, director, orgId } = await setupClub();
    const other = await createTestUser();
    await addOrgMember(orgId, other.user.id, "director");

    await start(owner.user.id, orgId, director.user.id);
    const { error } = await start(owner.user.id, orgId, other.user.id);

    expect(error?.message).toMatch(/TRANSFER_PENDING/);
  });

  it("an expired transfer no longer blocks a new one", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: first } = await start(owner.user.id, orgId, director.user.id);
    await adminClient
      .from("organization_ownership_transfers")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", first);

    const { data: second, error } = await start(owner.user.id, orgId, director.user.id);

    expect(error).toBeNull();
    expect(second).not.toBe(first);
    expect((await transfer(first)).status).toBe("expired");
  });

  it("clients cannot call the transfer functions or write transfers directly", async () => {
    const { owner, director, orgId } = await setupClub();

    const { error: rpcError } = await owner.client.rpc("start_ownership_transfer", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_to_profile_id: director.user.id,
    });
    const { error: insertError } = await owner.client.from("organization_ownership_transfers").insert({
      organization_id: orgId,
      from_profile_id: owner.user.id,
      to_profile_id: director.user.id,
    });

    expect(rpcError?.code).toBe("42501");
    expect(insertError).not.toBeNull();
  });

  it("the owner and the club's directors can see a pending transfer; others cannot", async () => {
    const { owner, director, orgId } = await setupClub();
    const outsider = await createTestUser();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    const seen = async (client: typeof owner.client) =>
      (await client.from("organization_ownership_transfers").select("id").eq("id", id)).data ?? [];

    expect(await seen(owner.client)).toHaveLength(1);
    expect(await seen(director.client)).toHaveLength(1);
    expect(await seen(outsider.client)).toHaveLength(0);
  });
});

// ── Responding ────────────────────────────────────────────────────────────────

describe("respond_ownership_transfer", () => {
  it("accepting makes the director the owner and the previous owner a director", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    const { error } = await respond(director.user.id, id, true);

    expect(error).toBeNull();
    expect(await roles(orgId)).toMatchObject({ [director.user.id]: "owner", [owner.user.id]: "director" });
    const row = await transfer(id);
    expect(row.status).toBe("accepted");
    expect(row.responded_at).not.toBeNull();
  });

  it("leaves the previous owner's teams theirs", async () => {
    const { owner, director, orgId, teamId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    await respond(director.user.id, id, true);

    const { data: team } = await adminClient.from("teams").select("owner_id").eq("id", teamId).single();
    expect(team?.owner_id).toBe(owner.user.id);
  });

  it("declining changes nothing", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    expect((await respond(director.user.id, id, false)).error).toBeNull();

    expect(await roles(orgId)).toMatchObject({ [owner.user.id]: "owner", [director.user.id]: "director" });
    expect((await transfer(id)).status).toBe("declined");
  });

  it("only the recipient can respond", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    const { error } = await respond(owner.user.id, id, true);

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
  });

  it("a transfer can be answered once", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);
    await respond(director.user.id, id, false);

    const { error } = await respond(director.user.id, id, true);

    expect(error?.message).toMatch(/TRANSFER_NOT_PENDING/);
  });

  it("an expired transfer cannot be accepted", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);
    await adminClient
      .from("organization_ownership_transfers")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", id);

    const { error } = await respond(director.user.id, id, true);

    expect(error?.message).toMatch(/TRANSFER_EXPIRED/);
    expect((await roles(orgId))[owner.user.id]).toBe("owner");
  });

  it("a recipient removed as director in the meantime cannot accept", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    await adminClient.rpc("remove_org_director", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_profile_id: director.user.id,
    });
    const { error } = await respond(director.user.id, id, true);

    expect(error?.message).toMatch(/TRANSFER_NOT_PENDING/);
    expect((await transfer(id)).status).toBe("cancelled");
  });
});

describe("cancel_ownership_transfer", () => {
  it("the owner can cancel a pending transfer; the recipient cannot", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);

    const { error: byRecipient } = await cancel(director.user.id, id);
    const { error: byOwner } = await cancel(owner.user.id, id);

    expect(byRecipient?.message).toMatch(/NOT_AUTHORIZED/);
    expect(byOwner).toBeNull();
    expect((await transfer(id)).status).toBe("cancelled");
    expect((await respond(director.user.id, id, true)).error?.message).toMatch(/TRANSFER_NOT_PENDING/);
  });
});

// ── Recovery ──────────────────────────────────────────────────────────────────

describe("recover_club_ownership (support only)", () => {
  it("moves ownership to a director without the owner, and records it", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: pending } = await start(owner.user.id, orgId, director.user.id);

    const { data, error } = await adminClient.rpc("recover_club_ownership", {
      p_org_id: orgId,
      p_to_profile_id: director.user.id,
      p_reason: "Owner lost access to their email; confirmed by card last 4",
    });

    expect(error).toBeNull();
    expect(data.previous_owner_id).toBe(owner.user.id);
    expect(await roles(orgId)).toMatchObject({ [director.user.id]: "owner", [owner.user.id]: "director" });
    // The pending offer is superseded, and the recovery is on record.
    expect((await transfer(pending)).status).toBe("cancelled");
    const { data: recorded } = await adminClient
      .from("organization_ownership_transfers")
      .select("status, reason, from_profile_id")
      .eq("organization_id", orgId)
      .eq("status", "recovered");
    expect(recorded).toEqual([
      { status: "recovered", reason: "Owner lost access to their email; confirmed by card last 4", from_profile_id: owner.user.id },
    ]);
  });

  it("only to a director, and never from a client", async () => {
    const { owner, orgId } = await setupClub();
    const outsider = await createTestUser();

    const { error: notDirector } = await adminClient.rpc("recover_club_ownership", {
      p_org_id: orgId,
      p_to_profile_id: outsider.user.id,
      p_reason: "test",
    });
    const { error: fromClient } = await owner.client.rpc("recover_club_ownership", {
      p_org_id: orgId,
      p_to_profile_id: owner.user.id,
      p_reason: "test",
    });

    expect(notDirector?.message).toMatch(/NOT_A_DIRECTOR/);
    expect(fromClient?.code).toBe("42501");
  });
});

// ── Never ownerless ───────────────────────────────────────────────────────────

describe("an open club always has an owner", () => {
  it("the owner cannot delete their own owner row", async () => {
    const { owner, orgId } = await setupClub();

    const { error } = await owner.client
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("profile_id", owner.user.id);

    expect(error?.message).toMatch(/OWNER_REQUIRED/);
    expect((await roles(orgId))[owner.user.id]).toBe("owner");
  });

  it("the owner cannot demote themselves", async () => {
    const { owner, orgId } = await setupClub();

    const { error } = await owner.client
      .from("organization_members")
      .update({ role: "director" })
      .eq("organization_id", orgId)
      .eq("profile_id", owner.user.id);

    expect(error?.message).toMatch(/OWNER_REQUIRED/);
  });

  it("deleting the owner's account is refused while the club is open", async () => {
    const { owner, director, orgId } = await setupClub();
    // Hand over their team, so the club's ownership is the only thing in the way.
    await adminClient.from("teams").update({ owner_id: director.user.id }).eq("owner_id", owner.user.id);

    const { error } = await adminClient.auth.admin.deleteUser(owner.user.id);

    expect(error).not.toBeNull();
    expect((await roles(orgId))[owner.user.id]).toBe("owner");
  });

  it("the previous owner's account can go once ownership has moved", async () => {
    const { owner, director, orgId } = await setupClub();
    const { data: id } = await start(owner.user.id, orgId, director.user.id);
    await respond(director.user.id, id, true);
    // Their own team still names them as owner; hand it over as the delete route requires.
    await adminClient.from("teams").update({ owner_id: director.user.id }).eq("owner_id", owner.user.id);

    const { error } = await adminClient.auth.admin.deleteUser(owner.user.id);

    expect(error).toBeNull();
    expect((await roles(orgId))[director.user.id]).toBe("owner");
  });
});
