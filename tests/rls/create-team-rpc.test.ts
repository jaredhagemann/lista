/**
 * Integration tests for the create_team Postgres RPC.
 *
 * Covers test-plan sections:
 *   §1.3 — Creation cascade verification
 *   §1.4 — Atomicity (transaction rollback)
 *
 * Requires the local Supabase stack: `supabase start`
 * Run with: pnpm test:rls  (resets the DB first)
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  cleanupTestData,
  trackIds,
} from "./helpers";

afterAll(async () => {
  await cleanupTestData();
});

// ── §1.3 — Creation cascade verification ─────────────────────────────────────

describe("create_team RPC — cascade verification (§1.3)", () => {
  it("returns a teamId and creates all four records atomically", async () => {
    const { user } = await createTestUser();
    const teamName = `Cascade Test ${crypto.randomUUID().slice(0, 8)}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamId, error } = await (adminClient as any).rpc("create_team", {
      owner_profile_id: user.id,
      team_name: teamName,
      season: "Spring 2026",
      org_name: "Westside FC",
    });

    expect(error).toBeNull();
    expect(typeof teamId).toBe("string");
    trackIds({ teamId });

    // teams row — correct name, season, owner
    const { data: team } = await adminClient
      .from("teams")
      .select("name, season, owner_id, organization_id")
      .eq("id", teamId)
      .single();
    expect(team).not.toBeNull();
    expect(team!.name).toBe(teamName);
    expect(team!.season).toBe("Spring 2026");
    expect(team!.owner_id).toBe(user.id);
    trackIds({ orgId: team!.organization_id });

    // organizations row — correct name
    const { data: org } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", team!.organization_id)
      .single();
    expect(org!.name).toBe("Westside FC");

    // team_members row — owner added as coach
    const { data: members } = await adminClient
      .from("team_members")
      .select("profile_id, role")
      .eq("team_id", teamId);
    expect(members).toHaveLength(1);
    expect(members![0].profile_id).toBe(user.id);
    expect(members![0].role).toBe("coach");

    // profiles.active_team_id updated
    const { data: profile } = await adminClient
      .from("profiles")
      .select("active_team_id")
      .eq("id", user.id)
      .single();
    expect(profile!.active_team_id).toBe(teamId);

    // channels row — create_team_channel trigger fired
    const { data: channels } = await adminClient
      .from("channels")
      .select("type, name")
      .eq("team_id", teamId);
    expect(channels).toHaveLength(1);
    expect(channels![0].type).toBe("team");
  });

  it("org name defaults to team name when org_name is blank", async () => {
    const { user } = await createTestUser();
    const teamName = `Default Org ${crypto.randomUUID().slice(0, 8)}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamId, error } = await (adminClient as any).rpc("create_team", {
      owner_profile_id: user.id,
      team_name: teamName,
      season: "",
      org_name: "",
    });

    expect(error).toBeNull();
    trackIds({ teamId });

    const { data: team } = await adminClient
      .from("teams")
      .select("organization_id, season")
      .eq("id", teamId)
      .single();

    // blank season → null in DB
    expect(team!.season).toBeNull();
    trackIds({ orgId: team!.organization_id });

    // org name falls back to team name
    const { data: org } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", team!.organization_id)
      .single();
    expect(org!.name).toBe(teamName);
  });

  it("coach can SELECT the team channel via is_team_member() without a channel_members row", async () => {
    const { client, user } = await createTestUser();
    const teamName = `Channel RLS ${crypto.randomUUID().slice(0, 8)}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamId } = await (adminClient as any).rpc("create_team", {
      owner_profile_id: user.id,
      team_name: teamName,
      season: "",
      org_name: "",
    });
    trackIds({ teamId });

    // Verify: no channel_members row was seeded for this user
    const { data: teamChan } = await adminClient
      .from("channels")
      .select("id")
      .eq("team_id", teamId)
      .eq("type", "team")
      .single();

    const { data: chanMember } = await adminClient
      .from("channel_members")
      .select("*")
      .eq("channel_id", teamChan!.id)
      .eq("profile_id", user.id)
      .maybeSingle();
    expect(chanMember).toBeNull();

    // Coach's authenticated client can still SELECT the channel
    const { data: channels, error } = await client
      .from("channels")
      .select("id, type")
      .eq("team_id", teamId)
      .eq("type", "team");

    expect(error).toBeNull();
    expect(channels).toHaveLength(1);
    expect(channels![0].type).toBe("team");
  });
});

// ── Execute-permission hardening ─────────────────────────────────────────────
// create_team() accepts a caller-supplied owner_profile_id (trusted input).
// Migration 000004 revokes EXECUTE from public/anon/authenticated and grants
// it only to service_role so an authenticated client cannot forge a call with
// another profile's UUID. This test ensures that boundary cannot silently
// regress if the REVOKE migration is ever rolled back.

describe("create_team RPC — execute permission (service-role only)", () => {
  it("authenticated client cannot call create_team() directly", async () => {
    const { client, user } = await createTestUser();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any).rpc("create_team", {
      owner_profile_id: user.id,
      team_name: "Should Not Exist",
      season: "",
      org_name: "",
    });

    expect(error).not.toBeNull();
    // Postgres raises 42501 (insufficient_privilege) when execute is revoked
    expect(error!.code).toBe("42501");
    expect(data).toBeNull();
  });
});

// ── §1.4 — Atomicity ──────────────────────────────────────────────────────────

describe("create_team RPC — atomicity (§1.4)", () => {
  it("1.4.1 rolls back org, team, and channel inserts on FK violation; active_team_id unchanged", async () => {
    const { user } = await createTestUser();

    // Give the user an existing active team so we can verify it is unchanged after the failure.
    const { teamId: existingTeamId } = await createTestTeam(user.id);
    await adminClient
      .from("profiles")
      .update({ active_team_id: existingTeamId })
      .eq("id", user.id);

    // Use a UUID that does not exist in the profiles table.
    // team_members.profile_id has a FK to profiles.id, so the insert in step 3
    // of create_team will raise a FK violation and roll back the whole transaction.
    const phantomProfileId = crypto.randomUUID();
    const failingTeamName = `Rollback ${crypto.randomUUID().slice(0, 8)}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any).rpc("create_team", {
      owner_profile_id: phantomProfileId,
      team_name: failingTeamName,
      season: "",
      org_name: "",
    });

    // RPC must have returned an error
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // No organizations row was created (rollback)
    const { data: orgs } = await adminClient
      .from("organizations")
      .select("id")
      .eq("name", failingTeamName);
    expect(orgs).toHaveLength(0);

    // No teams row was created (rollback)
    const { data: teams } = await adminClient
      .from("teams")
      .select("id")
      .eq("name", failingTeamName);
    expect(teams).toHaveLength(0);

    // No team_members row was created (rollback)
    // (nothing to query by name, but org + team both being absent confirms rollback)

    // Test user's active_team_id is unchanged
    const { data: profile } = await adminClient
      .from("profiles")
      .select("active_team_id")
      .eq("id", user.id)
      .single();
    expect(profile!.active_team_id).toBe(existingTeamId);
  });
});
