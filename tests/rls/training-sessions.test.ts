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
  getDefaultCategoryId,
  createCategory,
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
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await player.client
      .from("training_sessions")
      .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category_id: catId })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(player.user.id);
  });

  it("parent inserts for managed child → allowed; created_by = parent, profile_id = child", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { data, error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: child, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category_id: catId })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.profile_id).toBe(child);
    expect(data!.created_by).toBe(parent.user.id);
  });

  it("forged created_by is overwritten by the trigger", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { data, error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: child, team_id: teamId, created_by: child, session_date: todayStr(), duration_minutes: 30, category_id: catId })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(parent.user.id); // not the forged child id
  });

  it("parent inserts for themselves (not a player) → denied", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    await addTeamMember(teamId, child, "player");

    const { error } = await parent.client
      .from("training_sessions")
      .insert({ profile_id: parent.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category_id: catId });
    expect(error).not.toBeNull();
  });

  it("coach inserts for a player → denied (not self/managed)", async () => {
    const { coach, teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("training_sessions")
      .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category_id: catId });
    expect(error).not.toBeNull();
  });

  it("player inserts against a team they're not on → denied", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const outsider = await createTestUser();
    const { error } = await outsider.client
      .from("training_sessions")
      .insert({ profile_id: outsider.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 30, category_id: catId });
    expect(error).not.toBeNull();
  });

  it("free-tier org insert → denied; canceled → denied; past_due & trialing → allowed", async () => {
    const { orgId, teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const attempt = () =>
      player.client
        .from("training_sessions")
        .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 20, category_id: catId });

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

    const asTeammate = await teammate.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asTeammate.data!.length).toBe(0);

    const asCoach = await coach.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asCoach.data!.length).toBe(1);

    // a coach of a DIFFERENT team in the same org, where the player is NOT a
    // roster player, cannot read the player's rows.
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

  it("global coach visibility: a coach on any of the player's current teams reads all rows, incl. rows logged through another team", async () => {
    // Player is on team A (coachA) and team B (coachB), different orgs. They log
    // through A. coachB must be able to read that A-context row (global model).
    const { coach: coachA, teamId: teamA } = await clubTeam();
    const catA = await getDefaultCategoryId(teamA);
    const { coach: coachB, teamId: teamB } = await clubTeam();

    const player = await createTestUser();
    await addTeamMember(teamA, player.user.id, "player");
    await addTeamMember(teamB, player.user.id, "player");

    await insertSession({ profileId: player.user.id, teamId: teamA, createdBy: player.user.id, categoryId: catA });

    // coachB (no shared team_id on the row, but a current team of the player) sees it
    const asCoachB = await coachB.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asCoachB.data!.length).toBe(1);
    expect(asCoachB.data![0].team_id).toBe(teamA);

    // a coach with no current relationship to the player sees nothing
    const strangerCoach = await createTestUser();
    const { teamId: teamC } = await createTestTeam(strangerCoach.user.id);
    await setOrgPlan((await adminClient.from("teams").select("organization_id").eq("id", teamC).single()).data!.organization_id, "club_small", "active");
    const asStranger = await strangerCoach.client.from("training_sessions").select().eq("profile_id", player.user.id);
    expect(asStranger.data!.length).toBe(0);
  });

  it("delete: own allowed, teammate denied, coach allowed", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const teammate = await createTestUser();
    await addTeamMember(teamId, teammate.user.id, "player");

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(seedOldSession({ profileId: player.user.id, teamId, date: todayStr() }));
    }

    await teammate.client.from("training_sessions").delete().eq("id", ids[0]);
    expect((await adminClient.from("training_sessions").select().eq("id", ids[0])).data!.length).toBe(1);

    expect((await player.client.from("training_sessions").delete().eq("id", ids[0])).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", ids[0])).data!.length).toBe(0);

    expect((await coach.client.from("training_sessions").delete().eq("id", ids[1])).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", ids[1])).data!.length).toBe(0);
  });

  it("delete window: player can delete in-window, not 8+ days old; coach can delete old", async () => {
    const { coach, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const recent = seedOldSession({ profileId: player.user.id, teamId, date: todayStr() });
    const old = seedOldSession({ profileId: player.user.id, teamId, date: todayStr(-30) });

    expect((await player.client.from("training_sessions").delete().eq("id", recent)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", recent)).data!.length).toBe(0);

    await player.client.from("training_sessions").delete().eq("id", old);
    expect((await adminClient.from("training_sessions").select().eq("id", old)).data!.length).toBe(1);

    expect((await coach.client.from("training_sessions").delete().eq("id", old)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", old)).data!.length).toBe(0);
  });

  it("edit-vs-delete after leaving the logging-context team: in-window delete allowed, edit denied", async () => {
    // Player on A and B logs through A, then leaves A (still on B). Within the
    // 7-day window: self-delete allowed (ownership+window), edit denied (update
    // policy + trigger require current membership on the context team).
    const { teamId: teamA } = await clubTeam();
    const catA = await getDefaultCategoryId(teamA);
    const { teamId: teamB } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamA, player.user.id, "player");
    await addTeamMember(teamB, player.user.id, "player");

    const id1 = seedOldSession({ profileId: player.user.id, teamId: teamA, date: todayStr(), categoryId: catA });
    const id2 = seedOldSession({ profileId: player.user.id, teamId: teamA, date: todayStr(), categoryId: catA });

    // Remove team-A membership (still a player on B).
    await adminClient.from("team_members").delete().eq("team_id", teamA).eq("profile_id", player.user.id);

    // edit denied (row unchanged)
    await player.client.from("training_sessions").update({ duration_minutes: 99 }).eq("id", id1);
    expect((await adminClient.from("training_sessions").select("duration_minutes").eq("id", id1).single()).data!.duration_minutes).toBe(10);

    // in-window self-delete still allowed
    expect((await player.client.from("training_sessions").delete().eq("id", id2)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", id2)).data!.length).toBe(0);
  });

  it("duration CHECK bounds: 999 and 3 denied; 5 and 300 accepted", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const base = { profile_id: player.user.id, team_id: teamId, session_date: todayStr(), category_id: catId };

    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 999 })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 3 })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 5 })).error).toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, duration_minutes: 300 })).error).toBeNull();
  });

  it("opt-out toggle RLS: self allowed, parent-of-child allowed, non-manager denied", async () => {
    const a = await createTestUser();
    expect((await a.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id)).error).toBeNull();

    const parent = await createTestUser();
    const child = await createManagedProfile(parent.user.id, { firstName: "Kid" });
    expect((await parent.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", child)).error).toBeNull();
    expect((await adminClient.from("profiles").select("training_leaderboard_opt_out").eq("id", child).single()).data!.training_leaderboard_opt_out).toBe(true);

    const stranger = await createTestUser();
    await stranger.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id);
    await adminClient.from("profiles").update({ training_leaderboard_opt_out: false }).eq("id", a.user.id);
    await stranger.client.from("profiles").update({ training_leaderboard_opt_out: true }).eq("id", a.user.id);
    expect((await adminClient.from("profiles").select("training_leaderboard_opt_out").eq("id", a.user.id).single()).data!.training_leaderboard_opt_out).toBe(false);
  });

  // ── §2 validation trigger ───────────────────────────────────────────────────

  it("future date rejected; 8 days ago rejected; 7 days ago accepted", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const base = { profile_id: player.user.id, team_id: teamId, duration_minutes: 20, category_id: catId };

    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(1) })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(-8) })).error).not.toBeNull();
    expect((await player.client.from("training_sessions").insert({ ...base, session_date: todayStr(-7) })).error).toBeNull();
  });

  it("invalid teams.timezone still allows insert (UTC fallback)", async () => {
    const { teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // NB: "PST" is intentionally excluded — Postgres accepts it as a valid tz
    // abbreviation (UTC-8), so safe_team_tz() does NOT fall back to UTC for it.
    for (const tz of ["", "Pacific Time", "Not/AZone", null]) {
      await adminClient.from("teams").update({ timezone: tz }).eq("id", teamId);
      const { error } = await player.client
        .from("training_sessions")
        .insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 15, category_id: catId });
      expect(error, `tz=${tz}`).toBeNull();
    }
  });

  it("category must belong to the logging-context team and be active (rule 6)", async () => {
    const { teamId: teamA } = await clubTeam();
    const catA = await getDefaultCategoryId(teamA);
    const { teamId: teamB } = await clubTeam();
    const catB = await getDefaultCategoryId(teamB);
    const archived = await createCategory(teamA, "Archived", { isActive: false });

    const player = await createTestUser();
    await addTeamMember(teamA, player.user.id, "player");

    const ins = (categoryId: string) =>
      player.client.from("training_sessions").insert({ profile_id: player.user.id, team_id: teamA, session_date: todayStr(), duration_minutes: 20, category_id: categoryId });

    expect((await ins(catB)).error).not.toBeNull();      // another team's category
    expect((await ins(archived)).error).not.toBeNull();  // archived category
    expect((await ins(catA)).error).toBeNull();          // active same-team category

    // repoint an existing row to a foreign category → rejected
    const rowId = seedOldSession({ profileId: player.user.id, teamId: teamA, date: todayStr(), categoryId: catA });
    await player.client.from("training_sessions").update({ category_id: catB }).eq("id", rowId);
    expect((await adminClient.from("training_sessions").select("category_id").eq("id", rowId).single()).data!.category_id).toBe(catA);
  });

  it("rule 6 is conditional: archiving a category does not freeze edits on its sessions", async () => {
    const { coach, teamId } = await clubTeam();
    const catId = await createCategory(teamId, "Temp", { createdBy: coach.user.id });
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const rowId = seedOldSession({ profileId: player.user.id, teamId, date: todayStr(), categoryId: catId });

    // archive the category
    await coach.client.from("training_categories").update({ is_active: false }).eq("id", catId);

    // editing duration (leaving category_id unchanged) must still be accepted
    expect((await player.client.from("training_sessions").update({ duration_minutes: 25 }).eq("id", rowId)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select("duration_minutes").eq("id", rowId).single()).data!.duration_minutes).toBe(25);
  });

  it("a client cannot null the logging context to bypass validation", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const rowId = seedOldSession({ profileId: player.user.id, teamId, date: todayStr() });

    // nulling category_id alone → blocked by the RLS UPDATE WITH CHECK
    await player.client.from("training_sessions").update({ category_id: null }).eq("id", rowId);
    expect((await adminClient.from("training_sessions").select("category_id").eq("id", rowId).single()).data!.category_id).not.toBeNull();

    // nulling category_id while also pushing a future date must not slip past
    // date/category validation → rejected, row unchanged
    await player.client.from("training_sessions").update({ category_id: null, session_date: todayStr(1) }).eq("id", rowId);
    const afterUser = await adminClient.from("training_sessions").select("category_id, session_date").eq("id", rowId).single();
    expect(afterUser.data!.category_id).not.toBeNull();
    expect(afterUser.data!.session_date).toBe(todayStr());

    // even a service-role write (bypasses RLS) can't null the context AND change
    // another field: the tight cascade exception doesn't match, so the trigger
    // runs full validation and rejects it.
    const svc = await adminClient.from("training_sessions").update({ category_id: null, session_date: todayStr(1) }).eq("id", rowId);
    expect(svc.error).not.toBeNull();
  });

  it("created_by is immutable on update", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const rowId = seedOldSession({ profileId: player.user.id, teamId, date: todayStr() });

    // player tries to rewrite created_by while editing → stays the original
    await player.client.from("training_sessions").update({ duration_minutes: 22, created_by: crypto.randomUUID() }).eq("id", rowId);
    const after = await adminClient.from("training_sessions").select("created_by, duration_minutes").eq("id", rowId).single();
    expect(after.data!.created_by).toBe(player.user.id);
    expect(after.data!.duration_minutes).toBe(22);
  });

  it("archived team: insert & update rejected; director delete allowed; row still selectable", async () => {
    const { orgId, teamId } = await clubTeam();
    const catId = await getDefaultCategoryId(teamId);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const director = await createTestUser();
    await adminClient.from("organization_members").insert({ organization_id: orgId, profile_id: director.user.id, role: "director" });

    const sessionId = seedOldSession({ profileId: player.user.id, teamId, date: todayStr() });

    await archiveTeam(teamId);

    expect((await player.client.from("training_sessions").insert({ profile_id: player.user.id, team_id: teamId, session_date: todayStr(), duration_minutes: 10, category_id: catId })).error).not.toBeNull();
    await player.client.from("training_sessions").update({ duration_minutes: 25 }).eq("id", sessionId);
    expect((await adminClient.from("training_sessions").select("duration_minutes").eq("id", sessionId).single()).data!.duration_minutes).toBe(10);
    expect((await director.client.from("training_sessions").delete().eq("id", sessionId)).error).toBeNull();
    expect((await adminClient.from("training_sessions").select().eq("id", sessionId)).data!.length).toBe(0);
  });

  it("daily cap: 361 rejected, 360 accepted; across two teams", async () => {
    const { orgId, teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 300 })).error).toBeNull();
    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 61 })).error).not.toBeNull();
    expect((await insertSession({ profileId: player.user.id, teamId, createdBy: player.user.id, minutes: 60 })).error).toBeNull();

    const team2 = await adminClient.from("teams").insert({ id: crypto.randomUUID(), organization_id: orgId, name: "T2", owner_id: player.user.id }).select().single();
    await addTeamMember(team2.data!.id, player.user.id, "player");
    expect((await insertSession({ profileId: player.user.id, teamId: team2.data!.id, createdBy: player.user.id, minutes: 5 })).error).not.toBeNull();
  });

  it("cap excludes the edited row on update", async () => {
    const { teamId } = await clubTeam();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const only = seedOldSession({ profileId: player.user.id, teamId, date: todayStr(), minutes: 300 });
    expect((await player.client.from("training_sessions").update({ duration_minutes: 200 }).eq("id", only)).error).toBeNull();

    seedOldSession({ profileId: player.user.id, teamId, date: todayStr(), minutes: 100 });
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
