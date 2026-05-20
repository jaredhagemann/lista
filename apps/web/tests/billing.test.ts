/**
 * Unit tests for the Stripe price-tier mapping helpers (`@/lib/billing`).
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Stripe Integration →
 * Products & Prices" and "Database Changes" (team_limit semantics).
 *
 * Covers both directions:
 *   - `priceIdForPlan(plan)`        → returns the env-configured price ID
 *                                     and throws when the env var is missing
 *   - `planFromPriceId(priceId)`    → returns `{plan, teamLimit}` for known
 *                                     prices and `null` for unknown / missing
 *                                     / unconfigured prices (webhook safety)
 *   - `teamLimitForPlan(plan)`      → per-tier write value (1 / 10 / null)
 *
 * The helper reads `process.env` at call time so each test can isolate its
 * env via `vi.stubEnv`. `unstubAllEnvs` runs after every test.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  priceIdForPlan,
  planFromPriceId,
  teamLimitForPlan,
  FREE_TEAM_LIMIT,
  CLUB_SMALL_TEAM_LIMIT,
} from "@/lib/billing";

const SMALL_ID = "price_test_small_abc123";
const LARGE_ID = "price_test_large_xyz789";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("teamLimitForPlan", () => {
  it("returns 1 for free", () => {
    expect(teamLimitForPlan("free")).toBe(FREE_TEAM_LIMIT);
    expect(FREE_TEAM_LIMIT).toBe(1);
  });

  it("returns 10 for club_small", () => {
    expect(teamLimitForPlan("club_small")).toBe(CLUB_SMALL_TEAM_LIMIT);
    expect(CLUB_SMALL_TEAM_LIMIT).toBe(10);
  });

  it("returns null (unlimited) for club_large", () => {
    expect(teamLimitForPlan("club_large")).toBeNull();
  });
});

describe("priceIdForPlan", () => {
  it("returns the small env price for club_small", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(priceIdForPlan("club_small")).toBe(SMALL_ID);
  });

  it("returns the large env price for club_large", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(priceIdForPlan("club_large")).toBe(LARGE_ID);
  });

  it("reads env at call time, not module load (stubs apply post-import)", () => {
    // Both have already been imported above; this test still exercises a
    // fresh stub to prove the helper does not cache the first observed value.
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", "price_rotated_small");
    expect(priceIdForPlan("club_small")).toBe("price_rotated_small");
  });

  it("throws a descriptive error when the small env var is unset", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", "");
    expect(() => priceIdForPlan("club_small")).toThrow(
      /STRIPE_CLUB_SMALL_PRICE_ID/,
    );
  });

  it("throws a descriptive error when the large env var is unset", () => {
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", "");
    expect(() => priceIdForPlan("club_large")).toThrow(
      /STRIPE_CLUB_LARGE_PRICE_ID/,
    );
  });
});

describe("planFromPriceId", () => {
  it("maps the small price ID to club_small with team_limit 10", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId(SMALL_ID)).toEqual({
      plan: "club_small",
      teamLimit: 10,
    });
  });

  it("maps the large price ID to club_large with team_limit null", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId(LARGE_ID)).toEqual({
      plan: "club_large",
      teamLimit: null,
    });
  });

  it("returns null for an unknown price ID (event for an unrelated product)", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId("price_unknown_999")).toBeNull();
  });

  it("returns null for empty / null / undefined input", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId("")).toBeNull();
    expect(planFromPriceId(null)).toBeNull();
    expect(planFromPriceId(undefined)).toBeNull();
  });

  it("does not match against an unset env var (empty-string envs are not a match)", () => {
    // Webhook safety: if STRIPE_CLUB_SMALL_PRICE_ID is unconfigured, an event
    // carrying an empty price ID must not be silently mapped to club_small.
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", "");
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId("")).toBeNull();
    expect(planFromPriceId(LARGE_ID)).toEqual({
      plan: "club_large",
      teamLimit: null,
    });
  });

  it("reads env at call time so a rotation is picked up without reload", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", "price_rotated_small_v2");
    expect(planFromPriceId("price_rotated_small_v2")).toEqual({
      plan: "club_small",
      teamLimit: 10,
    });
  });

  it("round-trips priceIdForPlan ↔ planFromPriceId for both tiers", () => {
    vi.stubEnv("STRIPE_CLUB_SMALL_PRICE_ID", SMALL_ID);
    vi.stubEnv("STRIPE_CLUB_LARGE_PRICE_ID", LARGE_ID);
    expect(planFromPriceId(priceIdForPlan("club_small"))).toEqual({
      plan: "club_small",
      teamLimit: 10,
    });
    expect(planFromPriceId(priceIdForPlan("club_large"))).toEqual({
      plan: "club_large",
      teamLimit: null,
    });
  });
});
