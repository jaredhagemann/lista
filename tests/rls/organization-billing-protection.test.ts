/**
 * BUG-005: organization owners and directors could write any column of their
 * organization through the data API — including plan, subscription status,
 * Stripe ids, trial dates, team limit, subdomain and custom domain — bypassing
 * Stripe, the billing routes and the settings route's validation.
 *
 * No application code updates organizations through a user session: billing
 * routes, the Stripe webhook, crons and PATCH /api/club/settings all use the
 * service role after their own checks. So direct updates are refused for every
 * role, and organization settings go through the settings route, which already
 * separates owner from director (directors may change the operational name;
 * branding, subdomain and logo are owner-only).
 *
 * Direct-write cases use real authenticated clients. Route cases call the REAL
 * PATCH /api/club/settings against the local stack; only the cookie session and
 * the Redis tenant-cache invalidation are mocked.
 *
 * Requires the local Supabase stack. Run with: pnpm test:rls
 */

import { vi, describe, it, expect, afterAll, beforeEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: session.user } })) },
  })),
}));
vi.mock("@/lib/supabase/tenant", () => ({
  invalidateTenantCache: vi.fn(async () => undefined),
}));

import { PATCH as patchClubSettings } from "@/app/api/club/settings/route";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addOrgMember,
  setOrgPlan,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

beforeEach(() => {
  session.user = null;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function clubWith(role: "owner" | "director") {
  const creator = await createTestUser();
  const { orgId } = await createTestTeam(creator.user.id);
  await setOrgPlan(orgId, "free", "active");
  const member = await createTestUser();
  await addOrgMember(orgId, member.user.id, role);
  return { orgId, member };
}

async function orgRow(orgId: string) {
  const { data } = await adminClient.from("organizations").select("*").eq("id", orgId).single();
  return data!;
}

function patchAs(user: TestUser, body: Record<string, unknown>) {
  session.user = { id: user.user.id, email: user.user.email };
  return patchClubSettings(
    new Request("http://localhost/api/club/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

// ── Direct writes ─────────────────────────────────────────────────────────────

describe("organizations: no direct writes through the data API (BUG-005)", () => {
  it.each(["owner", "director"] as const)(
    "%s cannot upgrade their club and mark it paid",
    async (role) => {
      const { orgId, member } = await clubWith(role);

      await member.client
        .from("organizations")
        .update({ plan: "club_large", subscription_status: "active", team_limit: null })
        .eq("id", orgId);

      const org = await orgRow(orgId);
      expect(org.plan).toBe("free");
    }
  );

  it("owner cannot set Stripe provider ids", async () => {
    const { orgId, member } = await clubWith("owner");

    await member.client
      .from("organizations")
      .update({ stripe_customer_id: "cus_forged", stripe_subscription_id: "sub_forged" })
      .eq("id", orgId);

    const org = await orgRow(orgId);
    expect(org.stripe_customer_id).toBeNull();
    expect(org.stripe_subscription_id).toBeNull();
  });

  it("owner cannot reset trial state to claim another trial", async () => {
    const { orgId, member } = await clubWith("owner");
    const consumed = new Date("2026-01-01T00:00:00Z").toISOString();
    await adminClient.from("organizations").update({ trial_ends_at: consumed }).eq("id", orgId);

    await member.client.from("organizations").update({ trial_ends_at: null }).eq("id", orgId);

    const org = await orgRow(orgId);
    expect(new Date(org.trial_ends_at!).toISOString()).toBe(consumed);
  });

  it("owner cannot claim a subdomain or custom domain without the settings route's checks", async () => {
    const { orgId, member } = await clubWith("owner");
    const subdomain = `free-${orgId.slice(0, 8)}`;

    await member.client
      .from("organizations")
      .update({ subdomain, subdomain_status: "active", custom_domain: `${subdomain}.example.com` })
      .eq("id", orgId);

    const org = await orgRow(orgId);
    expect(org.subdomain).toBeNull();
    expect(org.custom_domain).toBeNull();
  });

  it("owner cannot edit even the name directly — settings go through the route", async () => {
    const { orgId, member } = await clubWith("owner");
    const before = (await orgRow(orgId)).name;

    await member.client.from("organizations").update({ name: "Renamed directly" }).eq("id", orgId);

    expect((await orgRow(orgId)).name).toBe(before);
  });
});

// ── Legitimate settings changes (owner vs director) ───────────────────────────

describe("PATCH /api/club/settings keeps the owner/director split (BUG-005)", () => {
  it("director can change the operational name", async () => {
    const { orgId, member } = await clubWith("director");

    const res = await patchAs(member, { orgId, orgName: "Director Renamed FC" });

    expect(res.status).toBe(200);
    expect((await orgRow(orgId)).name).toBe("Director Renamed FC");
  });

  it("director cannot change branding", async () => {
    const { orgId, member } = await clubWith("director");

    const res = await patchAs(member, { orgId, brandColor: "#123456" });

    expect(res.status).toBe(403);
    expect((await orgRow(orgId)).brand_color).toBeNull();
  });

  it("owner can change branding", async () => {
    const { orgId, member } = await clubWith("owner");

    const res = await patchAs(member, { orgId, brandColor: "#123456", orgNamePublic: "Owner FC" });

    expect(res.status).toBe(200);
    const org = await orgRow(orgId);
    expect(org.brand_color).toBe("#123456");
    expect(org.org_name_public).toBe("Owner FC");
  });

  it("the route ignores billing fields smuggled into the body", async () => {
    const { orgId, member } = await clubWith("owner");

    const res = await patchAs(member, {
      orgId,
      orgName: "Legit Rename",
      plan: "club_large",
      subscription_status: "active",
      stripe_customer_id: "cus_forged",
    });

    expect(res.status).toBe(200);
    const org = await orgRow(orgId);
    expect(org.name).toBe("Legit Rename");
    expect(org.plan).toBe("free");
    expect(org.stripe_customer_id).toBeNull();
  });
});
