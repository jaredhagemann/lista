import { describe, it, expect, afterAll } from "vitest";
import { createTestUser, createTestTeam, adminClient, cleanupTestData, trackIds } from "./helpers";

describe("organizations RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── INSERT ────────────────────────────────────────────────────────────────

  it("authenticated client cannot INSERT an organization directly", async () => {
    const { client } = await createTestUser();

    const { error } = await client
      .from("organizations")
      .insert({ name: "Direct Insert Org", slug: "direct-insert-org" });

    // Default-deny: no permissive INSERT policy exists.
    // Org creation must go through the create_team() service-role RPC.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501"); // RLS violation
  });

  it("org is created via create_team() RPC and owner can SELECT it", async () => {
    const { client, user } = await createTestUser();

    // The /api/teams server route calls create_team() via the service-role admin
    // client. Simulate that here by calling via adminClient.
    const { data: teamId, error: rpcError } = await adminClient.rpc("create_team", {
      owner_profile_id: user.id,
      team_name: "RPC Test Team",
      season: "2026",
      org_name: "RPC Test Org",
    });
    expect(rpcError).toBeNull();

    // Resolve the org created by the RPC and register both for cleanup
    const { data: teamRow } = await adminClient
      .from("teams")
      .select("organization_id")
      .eq("id", teamId as string)
      .single();
    const orgId = teamRow!.organization_id!;
    trackIds({ teamId: teamId as string, orgId });

    // The RPC enrolls the owner as a team member, so the SELECT policy grants
    // them visibility of the org.
    const { data, error } = await client
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });

  // ── SELECT ────────────────────────────────────────────────────────────────

  it("team member can SELECT their own org", async () => {
    const { client, user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { data, error } = await client
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });

  it("user cannot SELECT an org they have no membership in", async () => {
    const { user: userA } = await createTestUser();
    const { orgId } = await createTestTeam(userA.id);

    const { client: clientB } = await createTestUser();
    const { data, error } = await clientB
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS filters the row out
  });

  it("org member (organization_members row) can SELECT the org", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    // Get a signed-in client for the director BEFORE inserting the row
    const { client: dirClient, user: director } = await createTestUser();

    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: director.id, role: "director" });

    const { data, error } = await dirClient
      .from("organizations")
      .select()
      .eq("id", orgId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(orgId);
  });

  // ── Club-tier billing columns — visibility ────────────────────────────────
  // The 8 new lifecycle columns ride on the existing "Orgs visible to members"
  // SELECT policy, so the test surface is: org members can read every column,
  // non-members cannot read any. Asserted explicitly so a future column-level
  // policy regression (e.g. hiding billing from directors) shows up here.

  // Normalise timestamptz string formats — Postgres emits `+00:00`, JS emits
  // `Z`. Both parse to the same Unix ms; that's the equality we care about.
  const asInstant = (v: string | null) => (v ? Date.parse(v) : null);

  const BILLING_COLUMNS = [
    "plan",
    "team_limit",
    "subscription_status",
    "trial_ends_at",
    "pending_plan",
    "pending_plan_at",
    "stripe_schedule_id",
    "subscription_cancel_at",
    "trial_reminder_30d_sent_at",
    "trial_reminder_7d_sent_at",
    "trial_reminder_1d_sent_at",
  ] as const;

  // Single literal so the Supabase typegen narrows `data` properly
  // (multi-line `+` concatenation falls back to `GenericStringError`).
  const BILLING_SELECT =
    "plan, team_limit, subscription_status, trial_ends_at, pending_plan, pending_plan_at, stripe_schedule_id, subscription_cancel_at, trial_reminder_30d_sent_at, trial_reminder_7d_sent_at, trial_reminder_1d_sent_at";

  // A non-trivial value on every billing column so "absent" vs "present-but-null"
  // is unambiguous in the visibility assertions below.
  async function seedBillingState(orgId: string) {
    const trialEndsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const pendingPlanAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const subscriptionCancelAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const reminderSentAt = new Date(Date.now() - 86_400_000).toISOString();

    const { error } = await adminClient
      .from("organizations")
      .update({
        plan: "club_small",
        team_limit: 10,
        subscription_status: "trialing",
        trial_ends_at: trialEndsAt,
        pending_plan: "club_small",
        pending_plan_at: pendingPlanAt,
        stripe_schedule_id: "sub_sched_test_123",
        subscription_cancel_at: subscriptionCancelAt,
        trial_reminder_30d_sent_at: reminderSentAt,
        trial_reminder_7d_sent_at: reminderSentAt,
        trial_reminder_1d_sent_at: reminderSentAt,
      })
      .eq("id", orgId);
    expect(error).toBeNull();
    return { trialEndsAt, pendingPlanAt, subscriptionCancelAt, reminderSentAt };
  }

  it("owner can SELECT the club-tier billing columns", async () => {
    const { client, user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    // Owner membership lives in organization_members (separate from team_members).
    // The compound SELECT policy permits the read via either path; explicit owner
    // role here pins the "billing readable by owner" half of the spec.
    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: user.id, role: "owner" });

    const seeded = await seedBillingState(orgId);

    const { data, error } = await client
      .from("organizations")
      .select(BILLING_SELECT)
      .eq("id", orgId)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.plan).toBe("club_small");
    expect(data!.team_limit).toBe(10);
    expect(data!.subscription_status).toBe("trialing");
    // Postgres returns timestamptz as '+00:00'; JS toISOString returns 'Z'.
    // Compare on the parsed instant rather than the wire format.
    expect(asInstant(data!.trial_ends_at)).toBe(asInstant(seeded.trialEndsAt));
    expect(data!.pending_plan).toBe("club_small");
    expect(asInstant(data!.pending_plan_at)).toBe(asInstant(seeded.pendingPlanAt));
    expect(data!.stripe_schedule_id).toBe("sub_sched_test_123");
    expect(asInstant(data!.subscription_cancel_at)).toBe(asInstant(seeded.subscriptionCancelAt));
    expect(asInstant(data!.trial_reminder_30d_sent_at)).toBe(asInstant(seeded.reminderSentAt));
    expect(asInstant(data!.trial_reminder_7d_sent_at)).toBe(asInstant(seeded.reminderSentAt));
    expect(asInstant(data!.trial_reminder_1d_sent_at)).toBe(asInstant(seeded.reminderSentAt));

    // Defense-in-depth: confirm none of the 11 columns came back undefined,
    // which would indicate a column-level grant regression.
    for (const col of BILLING_COLUMNS) {
      expect(data, `column "${col}" missing from owner SELECT`).toHaveProperty(col);
    }
  });

  it("director can SELECT the club-tier billing columns", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);

    const { client: dirClient, user: director } = await createTestUser();
    await adminClient
      .from("organization_members")
      .insert({ organization_id: orgId, profile_id: director.id, role: "director" });

    const seeded = await seedBillingState(orgId);

    const { data, error } = await dirClient
      .from("organizations")
      .select(BILLING_SELECT)
      .eq("id", orgId)
      .single();

    // The spec's auth matrix lets directors read billing (`GET /api/billing/status`
    // accepts owner OR director). RLS must not contradict that.
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.plan).toBe("club_small");
    expect(data!.team_limit).toBe(10);
    expect(data!.subscription_status).toBe("trialing");
    expect(asInstant(data!.trial_ends_at)).toBe(asInstant(seeded.trialEndsAt));
    expect(data!.pending_plan).toBe("club_small");
    expect(data!.stripe_schedule_id).toBe("sub_sched_test_123");
    expect(asInstant(data!.subscription_cancel_at)).toBe(asInstant(seeded.subscriptionCancelAt));
  });

  it("non-member cannot SELECT the club-tier billing columns", async () => {
    const { user: owner } = await createTestUser();
    const { orgId } = await createTestTeam(owner.id);
    await seedBillingState(orgId);

    const { client: outsiderClient } = await createTestUser();
    const { data, error } = await outsiderClient
      .from("organizations")
      .select(BILLING_SELECT)
      .eq("id", orgId);

    // The org row is RLS-filtered out entirely — every column (including the
    // new billing columns) is unreachable. Returning 0 rows is the spec's
    // privacy boundary for non-members.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ── New CHECK constraints (DB-level) ──────────────────────────────────────
  // These run against the admin client because the goal is to verify the
  // CHECK constraint itself, not RLS. CHECK is enforced regardless of caller
  // identity. Postgres error code 23514 = `check_violation`.

  it("plan CHECK rejects the retired 'club' literal", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { error } = await adminClient
      .from("organizations")
      .update({ plan: "club" })
      .eq("id", orgId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // check_violation
    expect(error!.message).toMatch(/organizations_plan_check/i);
  });

  it("plan CHECK rejects an arbitrary invalid value", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { error } = await adminClient
      .from("organizations")
      .update({ plan: "enterprise" })
      .eq("id", orgId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
    expect(error!.message).toMatch(/organizations_plan_check/i);
  });

  it("plan CHECK accepts every spec-valid tier", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    for (const plan of ["free", "club_small", "club_large"] as const) {
      const { error } = await adminClient
        .from("organizations")
        .update({ plan })
        .eq("id", orgId);
      expect(error, `update plan=${plan} should succeed`).toBeNull();
    }
  });

  it("subscription_status CHECK accepts 'trialing'", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    // 'trialing' is the new status added by the club-tier migration. A
    // regression that drops it would silently break the entire trial flow.
    const { error } = await adminClient
      .from("organizations")
      .update({ subscription_status: "trialing" })
      .eq("id", orgId);

    expect(error).toBeNull();
  });

  it("subscription_status CHECK rejects an invalid value", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { error } = await adminClient
      .from("organizations")
      .update({ subscription_status: "incomplete" })
      .eq("id", orgId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
    expect(error!.message).toMatch(/organizations_subscription_status_check/i);
  });

  it("pending_plan CHECK rejects 'club_large'", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    // Only Large→Small downgrades are ever scheduled (Small→Large is immediate),
    // so 'club_large' is intentionally excluded from the pending_plan domain.
    const { error } = await adminClient
      .from("organizations")
      .update({ pending_plan: "club_large" })
      .eq("id", orgId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
    expect(error!.message).toMatch(/organizations_pending_plan_check/i);
  });

  it("pending_plan CHECK accepts 'club_small' and NULL", async () => {
    const { user } = await createTestUser();
    const { orgId } = await createTestTeam(user.id);

    const { error: setErr } = await adminClient
      .from("organizations")
      .update({ pending_plan: "club_small" })
      .eq("id", orgId);
    expect(setErr).toBeNull();

    const { error: clearErr } = await adminClient
      .from("organizations")
      .update({ pending_plan: null })
      .eq("id", orgId);
    expect(clearErr).toBeNull();
  });
});
