import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  setOrgPlan,
  archiveTeam,
  todayStr,
  insertSession,
  cleanupTestData,
  adminClient,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

async function clubOrg() {
  const owner = await createTestUser();
  const { orgId, teamId } = await createTestTeam(owner.user.id);
  await setOrgPlan(orgId, "club_small", "active");
  return { owner, orgId, teamId };
}

async function addTeam(orgId: string, ownerId: string, name = "Team") {
  const id = crypto.randomUUID();
  await adminClient.from("teams").insert({ id, organization_id: orgId, name, owner_id: ownerId });
  return id;
}

/** A player with a given last name on a team, with `minutes` logged today. */
async function playerWith(teamId: string, lastName: string, minutes: number) {
  const u = await createTestUser();
  await adminClient.from("profiles").update({ first_name: "P", last_name: lastName }).eq("id", u.user.id);
  await addTeamMember(teamId, u.user.id, "player");
  if (minutes > 0) await insertSession({ profileId: u.user.id, teamId, createdBy: u.user.id, minutes });
  return u;
}

function board(client: SupabaseClient, args: Record<string, unknown>) {
  return client.rpc("training_leaderboard", args);
}
function summary(client: SupabaseClient, args: Record<string, unknown>) {
  return client.rpc("training_summary", args);
}

const anchor = todayStr();

describe("training_leaderboard / training_summary RPC", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team scope: only that team's players, ranked; ties share rank and skip", async () => {
    const { owner, orgId, teamId } = await clubOrg();
    const a = await playerWith(teamId, "Alpha", 100);
    const b = await playerWith(teamId, "Bravo", 100);
    await playerWith(teamId, "Charlie", 50);
    // a player on a DIFFERENT team should not appear
    const otherTeam = await addTeam(orgId, owner.user.id, "Other");
    await playerWith(otherTeam, "Zeta", 200);

    const { data, error } = await board(a.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect(error).toBeNull();
    const rows = data as Array<{ profile_id: string; total_minutes: number; rank: number }>;
    // only teamId players with minutes (a, b, c) — owner had 0, excluded
    expect(rows.map((r) => r.profile_id).sort()).toEqual([a.user.id, b.user.id, rows.find((r) => r.total_minutes === 50)!.profile_id].sort());
    // ranks: 100→1, 100→1, 50→3
    const ranked = Object.fromEntries(rows.map((r) => [r.total_minutes, r.rank]));
    expect(ranked[100]).toBe(1);
    expect(ranked[50]).toBe(3);
  });

  it("opted-out and zero-minute players are absent from the board", async () => {
    const { teamId } = await clubOrg();
    const active = await playerWith(teamId, "Active", 60);
    const opted = await playerWith(teamId, "Hidden", 90);
    await adminClient.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", opted.user.id);
    await playerWith(teamId, "Zero", 0);

    const { data } = await board(active.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    const ids = (data as Array<{ profile_id: string }>).map((r) => r.profile_id);
    expect(ids).toContain(active.user.id);
    expect(ids).not.toContain(opted.user.id);
    expect(ids.length).toBe(1);
  });

  it("club scope: cross-team totals a member cannot read raw; names masked", async () => {
    const { owner, orgId, teamId: u10 } = await clubOrg();
    const u18 = await addTeam(orgId, owner.user.id, "U18");
    const u18player = await playerWith(u18, "Hale", 120);

    // Parent of a U10 child (so they're an org member via a non-archived team)
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid", lastName: "Young" });
    await addTeamMember(u10, child, "player");

    // Parent cannot raw-select the U18 player's row
    const raw = await parent.client.from("training_sessions").select().eq("profile_id", u18player.user.id);
    expect(raw.data!.length).toBe(0);

    // …but the club board returns the U18 player's total, name masked "P H."
    const { data, error } = await board(parent.client, { p_scope: "club", p_team_id: null, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    expect(error).toBeNull();
    const row = (data as Array<{ profile_id: string; total_minutes: number; display_name: string; team_id: string | null }>).find((r) => r.profile_id === u18player.user.id)!;
    expect(row.total_minutes).toBe(120);
    expect(row.display_name).toBe("P H.");
    expect(row.team_id).toBeNull(); // unfiltered club board
  });

  it("multi-team player: global total counts once on club and fully on each team board", async () => {
    const { owner, orgId, teamId: t1 } = await clubOrg();
    const t2 = await addTeam(orgId, owner.user.id, "T2");
    const p = await createTestUser();
    await adminClient.from("profiles").update({ first_name: "Multi", last_name: "Team" }).eq("id", p.user.id);
    await addTeamMember(t1, p.user.id, "player");
    await addTeamMember(t2, p.user.id, "player");
    await insertSession({ profileId: p.user.id, teamId: t1, createdBy: p.user.id, minutes: 90 });
    await insertSession({ profileId: p.user.id, teamId: t2, createdBy: p.user.id, minutes: 90 });

    // Unfiltered club: one row, 180, null team (counted once, not per membership)
    const all = await board(p.client, { p_scope: "club", p_team_id: null, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    const rows = (all.data as Array<{ profile_id: string; total_minutes: number; session_count: number; team_id: string | null }>).filter((r) => r.profile_id === p.user.id);
    expect(rows.length).toBe(1);
    expect(rows[0].total_minutes).toBe(180);
    expect(rows[0].session_count).toBe(2);
    expect(rows[0].team_id).toBeNull();

    // Club filtered to t1: the filter changes the cohort, NOT the minutes — the
    // player's GLOBAL 180 still shows, with the filter team populated.
    const filtered = await board(p.client, { p_scope: "club", p_team_id: t1, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    const fr = (filtered.data as Array<{ profile_id: string; total_minutes: number; team_id: string | null }>).find((r) => r.profile_id === p.user.id)!;
    expect(fr.total_minutes).toBe(180);
    expect(fr.team_id).toBe(t1);

    // Team scope t1: the full global total (180), not just t1's 90 — a session is
    // global to the player and counts fully on every team board they belong to.
    const team = await board(p.client, { p_scope: "team", p_team_id: t1, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect((team.data as Array<{ total_minutes: number }>)[0].total_minutes).toBe(180);
  });

  it("player who left the team drops off the board but keeps history", async () => {
    const { teamId } = await clubOrg();
    const viewer = await playerWith(teamId, "Viewer", 30);
    const leaver = await playerWith(teamId, "Leaver", 200);
    // leaver is on the board now
    let data = (await board(viewer.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).data as Array<{ profile_id: string }>;
    expect(data.map((r) => r.profile_id)).toContain(leaver.user.id);
    // remove leaver's roster row
    await adminClient.from("team_members").delete().eq("team_id", teamId).eq("profile_id", leaver.user.id);
    data = (await board(viewer.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).data as Array<{ profile_id: string }>;
    expect(data.map((r) => r.profile_id)).not.toContain(leaver.user.id);
    // history intact: leaver can still read own rows
    const own = await leaver.client.from("training_sessions").select().eq("profile_id", leaver.user.id);
    expect(own.data!.length).toBe(1);
  });

  it("archived team drops off club board but a director sees it in team scope", async () => {
    const { owner, orgId, teamId } = await clubOrg();
    const director = await createTestUser();
    await adminClient.from("organization_members").insert({ organization_id: orgId, profile_id: director.user.id, role: "director" });
    const p = await playerWith(teamId, "Arch", 45);
    await archiveTeam(teamId);

    // club board (director is org admin → passes caller check) excludes archived team
    const club = await board(director.client, { p_scope: "club", p_team_id: null, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    expect((club.data as Array<{ profile_id: string }>).map((r) => r.profile_id)).not.toContain(p.user.id);

    // team scope for the director still shows it
    const team = await board(director.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect((team.data as Array<{ profile_id: string }>).map((r) => r.profile_id)).toContain(p.user.id);
  });

  it("caller checks: non-member club → error; free-tier → error; team derives org", async () => {
    const { orgId, teamId } = await clubOrg();
    const member = await playerWith(teamId, "Member", 10);
    const outsider = await createTestUser();

    // outsider (not in org) calling club scope → error
    const out = await board(outsider.client, { p_scope: "club", p_team_id: null, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    expect(out.error).not.toBeNull();

    // team scope works with a null p_org_id (org derived from team)
    const t = await board(member.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect(t.error).toBeNull();

    // free-tier org → team scope errors regardless of any p_org_id passed
    await setOrgPlan(orgId, "free", "active");
    const free = await board(member.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect(free.error).not.toBeNull();
  });

  it("club filter team must belong to the org", async () => {
    const { orgId, teamId } = await clubOrg();
    const member = await playerWith(teamId, "Member", 10);
    // a team in a DIFFERENT org
    const other = await clubOrg();

    const bad = await board(member.client, { p_scope: "club", p_team_id: other.teamId, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    expect(bad.error).not.toBeNull();

    const good = await board(member.client, { p_scope: "club", p_team_id: teamId, p_org_id: orgId, p_period: "week", p_anchor: anchor });
    expect(good.error).toBeNull();
  });

  it("parameter validation: bad scope/period/missing ids raise", async () => {
    const { teamId } = await clubOrg();
    const member = await playerWith(teamId, "Member", 10);
    const bad = [
      { p_scope: "org", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor },
      { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "day", p_anchor: anchor },
      { p_scope: "team", p_team_id: null, p_org_id: null, p_period: "week", p_anchor: anchor },
      { p_scope: "club", p_team_id: null, p_org_id: null, p_period: "week", p_anchor: anchor },
    ];
    for (const args of bad) {
      expect((await board(member.client, args)).error, JSON.stringify(args)).not.toBeNull();
    }
  });

  it("week boundary: sessions in adjacent weeks bucket separately", async () => {
    const { teamId } = await clubOrg();
    const p = await playerWith(teamId, "Week", 0);
    // most recent Monday (this week) and the Sunday before it (last week) — both in window
    const now = new Date();
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    const thisMon = new Date(now); thisMon.setUTCDate(now.getUTCDate() - daysSinceMonday);
    const lastSun = new Date(thisMon); lastSun.setUTCDate(thisMon.getUTCDate() - 1);
    const monStr = thisMon.toISOString().slice(0, 10);
    const sunStr = lastSun.toISOString().slice(0, 10);
    await insertSession({ profileId: p.user.id, teamId, createdBy: p.user.id, date: monStr, minutes: 40 });
    await insertSession({ profileId: p.user.id, teamId, createdBy: p.user.id, date: sunStr, minutes: 25 });

    const thisWeek = await board(p.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: monStr });
    const lastWeek = await board(p.client, { p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: sunStr });
    expect((thisWeek.data as Array<{ total_minutes: number }>)[0].total_minutes).toBe(40);
    expect((lastWeek.data as Array<{ total_minutes: number }>)[0].total_minutes).toBe(25);
  });

  // ── training_summary ────────────────────────────────────────────────────────

  it("summary: denominator excludes opted-out, counts zero-minute; own totals + rank", async () => {
    const { teamId } = await clubOrg();
    const me = await playerWith(teamId, "Me", 100);
    await playerWith(teamId, "Rival", 200); // ranks above me
    await playerWith(teamId, "Zero", 0); // counted in denominator
    const opted = await playerWith(teamId, "Opted", 300);
    await adminClient.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", opted.user.id);

    const { data, error } = await summary(me.client, { p_profile_id: me.user.id, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor });
    expect(error).toBeNull();
    const s = (data as Array<{ total_minutes: number; session_count: number; rank: number; denominator: number }>)[0];
    expect(s.total_minutes).toBe(100);
    expect(s.session_count).toBe(1);
    expect(s.rank).toBe(2); // behind Rival(200)
    // cohort: me, Rival, Zero = 3 (Opted excluded), Opted not counted
    expect(s.denominator).toBe(3);
  });

  it("summary: zero-minute subject → null rank; opted-out subject still gets a rank", async () => {
    const { teamId } = await clubOrg();
    const zero = await playerWith(teamId, "Zero", 0);
    await playerWith(teamId, "Other", 50);
    const zs = (await summary(zero.client, { p_profile_id: zero.user.id, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).data as Array<{ rank: number | null; total_minutes: number }>;
    expect(zs[0].total_minutes).toBe(0);
    expect(zs[0].rank).toBeNull();

    // opted-out subject with minutes still gets a (hypothetical) rank
    const opted = await playerWith(teamId, "Opted", 120);
    await adminClient.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", opted.user.id);
    const os = (await summary(opted.client, { p_profile_id: opted.user.id, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).data as Array<{ rank: number | null }>;
    expect(os[0].rank).toBe(1); // 120 beats the 50
  });

  it("summary subject authorization: self/managed allowed, others denied", async () => {
    const { teamId } = await clubOrg();
    const me = await playerWith(teamId, "Me", 30);
    const other = await playerWith(teamId, "Other", 40);
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    // self ok
    expect((await summary(me.client, { p_profile_id: me.user.id, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).error).toBeNull();
    // managed child ok
    expect((await summary(parent.client, { p_profile_id: child, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).error).toBeNull();
    // another player's summary → error (opt-out leak guard)
    expect((await summary(me.client, { p_profile_id: other.user.id, p_scope: "team", p_team_id: teamId, p_org_id: null, p_period: "week", p_anchor: anchor })).error).not.toBeNull();
  });
});
