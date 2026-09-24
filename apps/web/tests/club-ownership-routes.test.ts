/**
 * The club ownership and closure routes (BUG-013, parts 2 and 3).
 *
 * The database functions decide who may do what (tests/rls/club-ownership and
 * club-closure). These tests pin what the routes add around them: the acting
 * user's id, the emails each step sends, Stripe, and how refusals reach the
 * client. Decisions (2026-09-24):
 *   - accepting a transfer moves Stripe's billing email to the new owner; the
 *     card on file is left alone
 *   - closing cancels the subscription immediately with no refund, before the
 *     club is closed, and tells every member
 *
 * Supabase, Stripe, the tenant cache and the email sender are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  // Rows by table and id; a query's last .eq() value picks the row.
  const rows: Record<string, Record<string, unknown>> = {};
  const from = vi.fn((table: string) => {
    let key: unknown;
    const result = () => Promise.resolve({ data: key !== undefined ? rows[table]?.[String(key)] ?? null : null, error: null });
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (_col: string, value: unknown) => {
        key = value;
        return chain;
      },
      single: result,
      maybeSingle: result,
    };
    return chain;
  });
  return {
    rows,
    from,
    rpc: vi.fn(),
    resolveRequestUser: vi.fn(),
    sendEmail: vi.fn(async () => undefined),
    customersUpdate: vi.fn(async () => ({})),
    subscriptionsCancel: vi.fn(async () => ({})),
    invalidateTenantCache: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/api-auth", () => ({
  resolveRequestUser: mocks.resolveRequestUser,
  adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: { update: mocks.customersUpdate },
    subscriptions: { cancel: mocks.subscriptionsCancel },
  }),
}));
vi.mock("@/lib/supabase/tenant", () => ({ invalidateTenantCache: mocks.invalidateTenantCache }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));

import { POST as startTransfer } from "@/app/api/club/ownership/transfer/route";
import { POST as cancelTransfer } from "@/app/api/club/ownership/cancel/route";
import { POST as respondTransfer } from "@/app/api/club/ownership/respond/route";
import { POST as closeClub } from "@/app/api/club/close/route";

const ORG = "org-1";
const OWNER = { id: "owner-1", email: "owner@test.local" };
const DIRECTOR = { id: "director-1", email: "director@test.local" };

function post(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcError(message: string) {
  return { data: null, error: { code: "P0001", message } };
}

function sent() {
  return (mocks.sendEmail.mock.calls as unknown as Array<[{ to: string; subject: string; html: string }]>).map(
    ([m]) => m
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.rows)) delete mocks.rows[key];
  mocks.rows.organizations = {
    [ORG]: {
      id: ORG,
      name: "Westside FC",
      plan: "club_small",
      subscription_status: "active",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      subdomain: "westside",
      custom_domain: null,
      closed_at: null,
      org_name_public: null,
      logo_url: null,
    },
  };
  mocks.rows.profiles = {
    [OWNER.id]: { id: OWNER.id, first_name: "Olive", last_name: "Owner", email: OWNER.email },
    [DIRECTOR.id]: { id: DIRECTOR.id, first_name: "Dana", last_name: "Director", email: DIRECTOR.email },
  };
  mocks.rows.organization_members = { [ORG]: { profile_id: OWNER.id } };
  mocks.resolveRequestUser.mockResolvedValue(OWNER);
});

// ── Starting a transfer ───────────────────────────────────────────────────────

describe("POST /api/club/ownership/transfer", () => {
  it("requires a signed-in user and a club and director", async () => {
    mocks.resolveRequestUser.mockResolvedValueOnce(null);
    expect((await startTransfer(post("/api/club/ownership/transfer", { orgId: ORG, toProfileId: DIRECTOR.id }))).status).toBe(401);
    expect((await startTransfer(post("/api/club/ownership/transfer", { orgId: ORG }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("starts it as the signed-in user and emails the director", async () => {
    mocks.rpc.mockResolvedValue({ data: "transfer-1", error: null });

    const res = await startTransfer(post("/api/club/ownership/transfer", { orgId: ORG, toProfileId: DIRECTOR.id }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transferId: "transfer-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("start_ownership_transfer", {
      p_actor_id: OWNER.id,
      p_org_id: ORG,
      p_to_profile_id: DIRECTOR.id,
    });
    const [email] = sent();
    expect(email.to).toBe(DIRECTOR.email);
    expect(email.subject).toContain("Westside FC");
    expect(email.html).toContain("Olive Owner");
    expect(email.html).toContain("14 days");
    expect(email.html).toContain("/dashboard/club");
  });

  it.each([
    ["NOT_AUTHORIZED: only the club owner can transfer ownership", 403],
    ["NOT_A_DIRECTOR: ownership can only go to a director of this club", 404],
    ["TRANSFER_PENDING: cancel the pending transfer first", 409],
    ["CLUB_CLOSED: this club is closed", 409],
  ])("maps %s to %i and sends nothing", async (message, status) => {
    mocks.rpc.mockResolvedValue(rpcError(message));

    const res = await startTransfer(post("/api/club/ownership/transfer", { orgId: ORG, toProfileId: DIRECTOR.id }));

    expect(res.status).toBe(status);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/club/ownership/cancel", () => {
  it("cancels as the signed-in user", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const res = await cancelTransfer(post("/api/club/ownership/cancel", { transferId: "transfer-1" }));

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_ownership_transfer", {
      p_actor_id: OWNER.id,
      p_transfer_id: "transfer-1",
    });
  });

  it("maps refusals", async () => {
    mocks.rpc.mockResolvedValueOnce(rpcError("NOT_AUTHORIZED: only the club owner can cancel a transfer"));
    expect((await cancelTransfer(post("/api/club/ownership/cancel", { transferId: "t" }))).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce(rpcError("TRANSFER_NOT_PENDING"));
    expect((await cancelTransfer(post("/api/club/ownership/cancel", { transferId: "t" }))).status).toBe(409);
  });
});

// ── Responding ────────────────────────────────────────────────────────────────

describe("POST /api/club/ownership/respond", () => {
  beforeEach(() => {
    mocks.resolveRequestUser.mockResolvedValue(DIRECTOR);
  });

  it("accepting moves Stripe's billing email to the new owner and tells the previous owner", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organization_id: ORG, from_profile_id: OWNER.id, to_profile_id: DIRECTOR.id, accepted: true },
      error: null,
    });

    const res = await respondTransfer(post("/api/club/ownership/respond", { transferId: "transfer-1", accept: true }));

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("respond_ownership_transfer", {
      p_actor_id: DIRECTOR.id,
      p_transfer_id: "transfer-1",
      p_accept: true,
    });
    // Only the email: the card on file stays until the new owner replaces it.
    expect(mocks.customersUpdate).toHaveBeenCalledWith("cus_123", { email: DIRECTOR.email });
    const [email] = sent();
    expect(email.to).toBe(OWNER.email);
    expect(email.html).toContain("Dana Director");
    expect(email.html).toMatch(/now the owner/i);
  });

  it("declining changes nothing in Stripe and tells the previous owner", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organization_id: ORG, from_profile_id: OWNER.id, to_profile_id: DIRECTOR.id, accepted: false },
      error: null,
    });

    await respondTransfer(post("/api/club/ownership/respond", { transferId: "transfer-1", accept: false }));

    expect(mocks.customersUpdate).not.toHaveBeenCalled();
    const [email] = sent();
    expect(email.to).toBe(OWNER.email);
    expect(email.html).toMatch(/declined/i);
  });

  it("a Stripe failure does not undo an accepted transfer", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organization_id: ORG, from_profile_id: OWNER.id, to_profile_id: DIRECTOR.id, accepted: true },
      error: null,
    });
    mocks.customersUpdate.mockRejectedValueOnce(new Error("stripe down"));

    const res = await respondTransfer(post("/api/club/ownership/respond", { transferId: "transfer-1", accept: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, billingEmailUpdated: false });
  });

  it("requires an explicit accept or decline", async () => {
    const res = await respondTransfer(post("/api/club/ownership/respond", { transferId: "transfer-1" }));

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_AUTHORIZED: this transfer is not addressed to you", 403],
    ["TRANSFER_NOT_PENDING", 409],
    ["TRANSFER_STALE: ownership or directorship changed since this transfer began", 409],
    ["TRANSFER_EXPIRED", 410],
  ])("maps %s to %i", async (message, status) => {
    mocks.rpc.mockResolvedValue(rpcError(message));

    const res = await respondTransfer(post("/api/club/ownership/respond", { transferId: "transfer-1", accept: true }));

    expect(res.status).toBe(status);
    expect(mocks.customersUpdate).not.toHaveBeenCalled();
  });
});

// ── Closing ───────────────────────────────────────────────────────────────────

describe("POST /api/club/close", () => {
  it("requires a signed-in user, a club and the typed name", async () => {
    mocks.resolveRequestUser.mockResolvedValueOnce(null);
    expect((await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Westside FC" }))).status).toBe(401);
    expect((await closeClub(post("/api/club/close", { orgId: ORG }))).status).toBe(400);
  });

  it("only the owner, and never touches Stripe for anyone else", async () => {
    mocks.resolveRequestUser.mockResolvedValue(DIRECTOR);

    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Westside FC" }));

    expect(res.status).toBe(403);
    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("a mistyped name is refused before Stripe", async () => {
    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Eastside" }));

    expect(res.status).toBe(400);
    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("an already closed club is refused before Stripe", async () => {
    (mocks.rows.organizations[ORG] as Record<string, unknown>).closed_at = "2026-09-01T00:00:00Z";

    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Westside FC" }));

    expect(res.status).toBe(409);
    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("cancels the subscription now with no refund, closes the club, and tells every member", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "club_member_emails") {
        return {
          data: [
            { email: "coach@test.local", first_name: "Cora" },
            { email: "parent@test.local", first_name: "Pat" },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: " westside fc " }));

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsCancel).toHaveBeenCalledWith("sub_123", { prorate: false, invoice_now: false });
    expect(mocks.rpc).toHaveBeenCalledWith("close_club", {
      p_actor_id: OWNER.id,
      p_org_id: ORG,
      p_confirm_name: " westside fc ",
    });
    expect(mocks.invalidateTenantCache).toHaveBeenCalledWith("westside.lista.team");
    expect(sent().map((m) => m.to).sort()).toEqual(["coach@test.local", "parent@test.local"]);
    expect(sent()[0].html).toMatch(/closed/i);
    expect(sent()[0].html).toMatch(/still read|remains readable|read-only/i);
    // Stripe first: a club is never closed while still billing.
    const cancelOrder = mocks.subscriptionsCancel.mock.invocationCallOrder[0];
    const closeOrder = mocks.rpc.mock.invocationCallOrder[mocks.rpc.mock.calls.findIndex(([fn]) => fn === "close_club")];
    expect(cancelOrder).toBeLessThan(closeOrder);
  });

  it("a club with no live subscription closes without Stripe", async () => {
    Object.assign(mocks.rows.organizations[ORG] as Record<string, unknown>, {
      plan: "free",
      subscription_status: null,
      stripe_subscription_id: null,
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Westside FC" }));

    expect(res.status).toBe(200);
    expect(mocks.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("if Stripe fails, the club stays open", async () => {
    mocks.subscriptionsCancel.mockRejectedValueOnce(new Error("stripe down"));

    const res = await closeClub(post("/api/club/close", { orgId: ORG, confirmName: "Westside FC" }));

    expect(res.status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalledWith("close_club", expect.anything());
  });
});
