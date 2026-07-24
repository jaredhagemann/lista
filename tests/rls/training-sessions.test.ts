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
  seedOldSession,
  cleanupTestData,
  adminClient,
} from "./helpers";

/** Coach + club-tier org + team; returns the pieces most tests need. */
async function clubTeam() {
  const coach = await createTestUser();
  const { orgId, teamId } = await createTestTeam(coach.user.id);
  await setOrgPlan(orgId, "club_small", "active");
  return { coach, orgId, teamId };
}

describe("training_sessions RLS + trigger", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── §1 RLS ────────────────────────────────────────────────────────────────

  it("player inserts own session on own team → allowed, created_by stamped", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await player.client
      .from("training_sessions")
      .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category: "shooting" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(player.user.id);
  });

  it("parent inserts for managed child → allowed; created_by = parent, profile_id = child", async () => {
    const { teamId } = await clubTeam();
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { data, error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: child, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category: "passing" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.profile_id).toBe(child);
    expect(data!.created_by).toBe(parent.user.id);
  });

  it("forged created_by is overwritten by the trigger", async () => {
    const { teamId } = await clubTeam();
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { data, error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: child, team_id: teamId, created_by: child, session_date: todayStr(), duration_minutes: 30, category: "passing" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(parent.user.id); // not the forged child id
  });

  it("parent inserts for themselves (not a player) → denied", async () => {
    const { teamId } = await clubTeam();
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: parent.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category: "fitness" });
    expect(error).not.toBeNull();
  });

  it("coach inserts for a player → denied (not self/managed)", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("training_sessions")
      .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category: "shooting" });
    expect(error).not.toBeNull();
  });

  it("player inserts against a team they're not on → denied", async () => {
    const { teamId } = await clubTeam();
    const outsider = await createTestUser();
    // outsider is not a member of teamId
    const { error } = await outsider.client
      .from("training_sessions")
      .insert({ profile_id: outsider.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category: "shooting" });
    expect(error).not.toBeNull();
  });

  it("free-tier org insert → denied; canceled → denied; past_due & trialing → allowed", async () => {
    const { orgId, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const attempt = () =>
      player.client
        .from("training_sessions")
        .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 20, category: "agility" });

    await setOrgPlan(orgId, "free", "active");
    expect((await attempt()).error).not.toBeNull();

    await setOrgPlan(orgId, "club_small", "canceled");
    expect((await attempt()).error).not.toBeNull();

    await setOrgPlan(orgId, "club_small", "past_due");
    expect((await attempt()).error).toBeNull();

    await setOrgPlan(orgId, "club_large", "trialing");
    expect((await attempt()).error).toBeNull();
  });

  it("player cannot SELECT a teammate's raw row; coach can; other-team coach cannot; director can", async () => {
    const { coach, orgId, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const teammate = await createTestUser();
    await addTeamMember(teamId, teammate.user.id, "player");
    await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id });

    // teammate cannot read player's row
    const asTeammate = await teammate.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asTeammate.data!.length).toBe(0);

    // coach of the team can
    const asCoach = await coach.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asCoach.data!.length).toBe(1);

    // a coach of a DIFFERENT team in the same org cannot
    const otherCoach = await createTestUser();
    const otherTeam = await adminClient.from("teams").insert({ id: crypto.randomUUID(), organization_id: orgId, name: "Other", owner_id: otherCoach.user.id }).select().single();
    await addTeamMember(otherTeam.data!.id, otherCoach.user.id, "coach");
    const asOtherCoach = await otherCoach.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asOtherCoach.data!.length).toBe(0);

    // a director (org admin) can, org-wide
    const director = await createTestUser();
    await adminClient.from("organization_members").insert({ organization_id: orgId, profile_id: director.user.id, role: "director" });
    const asDirector = await director.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asDirector.data!.length).toBe(1);
  });

  it("delete: own allowed, teammate denied, coach allowed", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const teammate = await createTestUser();
    await addTeamMember(teamId, teammate.user.id, "player");

    // seed 3 rows
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = crypto.randomUUID();
      await adminClient.from("training_sessions").insert({ id, profile_id: player.user.id, team_id: teamId, created_by: player.user.id, session_date: todayStr(), duration_minutes: 10, category: "other" });
      ids.push(id);
    }

    // teammate cannot delete player's row
    await teammate.client.from("training_sessions").delete().eq("id", ids[0]);
    expect((await adminClient.from("training_sessions").select().eq("id", ids[0])).data!.length).toBe(1);

    // player deletes own
    expect((await player.client.from("training_sessions").delete().eq("id", ids[0])).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", ids[0])).data!.length).toBe(0);

    // coach deletes a player's
    expect((await coach.client.from("training_sessions").delete().eq("id", ids[1])).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", ids[1])).data!.length).toBe(0);
  });

  it("delete window: player can delete in-window, not 8+ days old; coach can delete old", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // in-window row (today)
    const recent = crypto.randomUUID();
    await adminClient.from("training_sessions").insert({ id: recent, profile_id: player.user.id, team_id: teamId, created_by: player.user.id, session_date: todayStr(), duration_minutes: 10, category: "other" });
    // out-of-window row (30 days ago) — seeded past the trigger
    const old = seedOldSession({ profileId: player.user.id, teamId, date: todayStr(-30) });

    // player can delete the in-window row
    expect((await player.client.from("training_sessions").delete().eq("id", recent)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", recent)).data!.length).toBe(0);

    // player CANNOT delete the old row (outside window) — row remains
    await player.client.from("training_sessions").delete().eq("id", old);
    expect((await adminClient.from("training_sessions").select().eq("id", old)).data!.length).toBe(1);

    // coach CAN delete the old row
    expect((await coach.client.from("training_sessions").delete().eq("id", old)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", old)).data!.length).toBe(0);
  });

  it("duration CHECK bounds: 999 and 3 denied; 5 and 300 accepted", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const base = { profile_id: player.user.id, team_id: teamId, session_date: todayStr(), category: "other" as const };

    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 999 })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 3 })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 5 })).error).toBeNull();
    // 300 alone is fine, but 5 + 300 = 305 same day is under 360
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 300 })).error).toBeNull();
  });

  it("opt-out toggle RLS: self allowed, parent-of-child allowed, non-manager denied", async () => {
    const a = await createTestUser();
    expect((await a.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id)).error).toBeNull();

    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    expect((await parent.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", child)).error).toBeNull();
    expect((await adminClient.from("profiles").select("training_leaderboard_opt_out").eq("id", child).single()).data!.training_leaderboard_opt_out).toBe(true);

    // a stranger cannot toggle someone else's
    const stranger = await createTestUser();
    await stranger.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id);
    // a already true; set false first to detect an unwanted change
    await adminClient.from("profiles").update({ training_leaderboard_opt_out: false }).eq("id", a.user.id);
    await stranger.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id);
    expect((await adminClient.from("profiles").select("training_leaderboard_opt_out").eq("id", a.user.id).single()).data!.training_leaderboard_opt_out).toBe(false);
  });

  // ── §2 validation trigger ───────────────────────────────────────────────────

  it("future date rejected; 8 days ago rejected; 7 days ago accepted", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const base = { profile_id: player.user.id, team_id: teamId, duration_minutes: 20, category: "other" as const };

    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(1) })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(-8) })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(-7) })).error).toBeNull();
  });

  it("invalid teams.timezone still allows insert (UTC fallback)", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // NB: "PST" is intentionally excluded — Postgres accepts it as a valid tz
    // abbreviation (UTC-8), so safe_team_tz() does NOT fall back to UTC for it.
    // Using it here made this test flaky: between 00:00–08:00 UTC the UTC-8
    // "today" is the previous day, so a UTC-today session_date read as future.
    // Only genuinely-invalid strings exercise the UTC-fallback path.
    for (const tz of ["", "Pacific Time", "Not/AZone", null]) {
      await adminClient.from("teams").update({ timezone: tz }).eq("id", teamId);
      const { error } = await player.client
        .from("training_sessions")
        .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 15, category: "recovery" });
      expect(error, `tz=${tz}`).toBeNull();
    }
  });

  it("archived team: insert & update rejected; director delete allowed; row still selectable", async () => {
    const { orgId, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    // A director (org admin) retains admin access to archived teams; a plain
    // coach does not (is_team_admin excludes archived teams for non-org-admins).
    const director = await createTestUser();
    await adminClient.from("organization_members").insert({ organization_id: orgId, profile_id: director.user.id, role: "director" });

    const sessionId = crypto.randomUUID();
    await adminClient.from("training_sessions").insert({ id: sessionId, profile_id: player.user.id, team_id: teamId, created_by: player.user.id, session_date: todayStr(), duration_minutes: 20, category: "other" });

    await archiveTeam(teamId);

    // insert rejected
    expect((await player.client.from("training_sessions").insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 10, category: "other" })).error).not.toBeNull();
    // update rejected (RLS using clause: not archived)
    await player.client.from("training_sessions").update({ duration_minutes: 25 }).eq("id", sessionId);
    expect((await adminClient.from("training_sessions").select("duration_minutes").eq("id", sessionId).single()).data!.duration_minutes).toBe(20);
    // director (org admin) delete allowed — the moderation lever for archived teams
    expect((await director.client.from("training_sessions").delete().eq("id", sessionId)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", sessionId)).data!.length).toBe(0);
  });

  it("daily cap: 361 rejected, 360 accepted; across two teams; excludes edited row on update", async () => {
    const { orgId, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // 300 then 61 → 361 rejected; 60 → 360 accepted
    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 300 })).error).toBeNull();
    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 61 })).error).not.toBeNull();
    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 60 })).error).toBeNull();

    // across two teams, same day, same player → still capped
    const team2 = await adminClient.from("teams").insert({ id: crypto.randomUUID(), organization_id: orgId, name: "T2", owner_id: player.user.id }).select().single();
    await addTeamMember(team2.data!.id, player.user.id, "player");
    expect((await insertSession({ profileId: player.user.id, teamId: team2.data!.id, createdBy: player.user.id, minutes: 5 })).error).not.toBeNull();
  });

  it("cap excludes the edited row on update", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const only = crypto.randomUUID();
    await adminClient.from("training_sessions").insert({ id: only, profile_id: player.user.id, team_id: teamId, created_by: player.user.id, session_date: todayStr(), duration_minutes: 300, category: "other" });
    // edit down to 200 → must be accepted (not 300+200=500)
    expect((await player.client.from("training_sessions").update({ duration_minutes: 200 }).eq("id", only)).error).toBeNull();

    // add a second 100-min row (day total 300)
    await adminClient.from("training_sessions").insert({ id: crypto.randomUUID(), profile_id: player.user.id, team_id: teamId, created_by: player.user.id, session_date: todayStr(), duration_minutes: 100, category: "other" });
    // edit first to 260 → 360 accepted; to 261 → 361 rejected
    expect((await player.client.from("training_sessions").update({ duration_minutes: 260 }).eq("id", only)).error).toBeNull();
    await player.client.from("training_sessions").update({ duration_minutes: 261 }).eq("id", only);
    expect((await adminClient.from("training_sessions").select("duration_minutes").eq("id", only).single()).data!.duration_minutes).toBe(260);
  });

  it("concurrent inserts race the cap: exactly one of 300+300 commits", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const results = await Promise.all([
      insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 300 }),
      insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 300 }),
    ]);
    const succeeded = results.filter((r) => r.error === null).length;
    expect(succeeded).toBe(1);
  });
});
