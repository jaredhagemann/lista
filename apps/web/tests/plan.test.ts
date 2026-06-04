/**
 * Unit tests for the shared plan-tier predicates (`@/lib/plan`).
 *
 * These back the club-dashboard access gate (spec → Feature Gating). The gate
 * is intentionally compound: neither a club tier nor an access-granting status
 * alone is sufficient. A `free` org with a stale `trialing` status (e.g. a
 * partial write) must be denied, and a `club_*` org that has been `canceled`
 * must lose access. `past_due` keeps access so a failed payment can be fixed
 * before features are revoked.
 */
import { describe, it, expect } from "vitest";
import { isClubPlan, hasClubAccess } from "@/lib/plan";

describe("isClubPlan", () => {
  it("is true for both club tiers", () => {
    expect(isClubPlan("club_small")).toBe(true);
    expect(isClubPlan("club_large")).toBe(true);
  });

  it("is false for free, null, undefined, and the retired legacy 'club' value", () => {
    expect(isClubPlan("free")).toBe(false);
    expect(isClubPlan("club")).toBe(false);
    expect(isClubPlan(null)).toBe(false);
    expect(isClubPlan(undefined)).toBe(false);
  });
});

describe("hasClubAccess", () => {
  it("grants access to a club tier with trialing/active/past_due", () => {
    expect(hasClubAccess("club_small", "trialing")).toBe(true);
    expect(hasClubAccess("club_large", "active")).toBe(true);
    expect(hasClubAccess("club_small", "past_due")).toBe(true);
  });

  it("denies a free plan even with a stale 'trialing' status", () => {
    expect(hasClubAccess("free", "trialing")).toBe(false);
    expect(hasClubAccess("free", "active")).toBe(false);
  });

  it("denies a canceled club org (already downgraded)", () => {
    expect(hasClubAccess("club_small", "canceled")).toBe(false);
    expect(hasClubAccess("club_large", "canceled")).toBe(false);
  });

  it("denies when subscription_status is null/undefined", () => {
    expect(hasClubAccess("club_small", null)).toBe(false);
    expect(hasClubAccess("club_large", undefined)).toBe(false);
  });

  it("denies the retired legacy 'club' plan value regardless of status", () => {
    expect(hasClubAccess("club", "active")).toBe(false);
  });
});
