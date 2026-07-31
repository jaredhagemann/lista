import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  setOrgPlan,
  cleanupTestData,
} from "./helpers";
import { hasClubAccess } from "@/lib/plan";

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
});
