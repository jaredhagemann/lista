import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  setOrgPlan,
  todayStr,
  cleanupTestData,
} from "./helpers";
import { hasClubAccess } from "@/lib/plan";
import { TRAINING_CATEGORIES } from "@/lib/training";

const PLANS = ["free", "club_small", "club_large"] as const;
const STATUSES = ["trialing", "active", "past_due", "canceled"] as const;

describe("training drift guards", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("has_club_access (SQL) agrees with hasClubAccess (TS) on every (plan, status) pair", async () => {
    const user = await createTestUser();
    const { orgId } = await createTestTeam(user.user.id);

    for (const plan of PLANS) {
      for (const status of STATUSES) {
        await setOrgPlan(orgId, plan, status);
        const { data, error } = await user.client.rpc("has_club_access", { o_id: orgId });
        expect(error, `${plan}/${status}`).toBeNull();
        expect(data, `${plan}/${status}`).toBe(hasClubAccess(plan, status));
      }
    }
  });

  it("every TRAINING_CATEGORIES value satisfies the category CHECK; a bogus one is rejected", async () => {
    const coach = await createTestUser();
    const { orgId, teamId } = await createTestTeam(coach.user.id);
    await setOrgPlan(orgId, "club_small", "active");
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // All nine categories accepted (5 min each keeps the day well under the cap).
    for (const category of TRAINING_CATEGORIES) {
      const { error } = await player.client.from("training_sessions").insert({
        profile_id: player.user.id,
        team_id: teamId,
        session_date: todayStr(),
        duration_minutes: 5,
        category,
      });
      expect(error, category).toBeNull();
    }

    // A value outside the constraint is rejected.
    const { error: bogus } = await player.client.from("training_sessions").insert({
      profile_id: player.user.id,
      team_id: teamId,
      session_date: todayStr(),
      duration_minutes: 5,
      category: "not_a_real_category",
    });
    expect(bogus).not.toBeNull();
  });
});
