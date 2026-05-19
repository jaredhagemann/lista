/**
 * Plan-tier predicates — single source of truth for "is this a club org?" and
 * the club-dashboard access gate (spec: Club Tier Upgrade & Monetization →
 * Feature Gating).
 *
 * The legacy single `'club'` plan value was retired by migration
 * 20260519000000_club_tier_monetization.sql and split into `'club_small'` /
 * `'club_large'`. Every gate that previously checked `plan === 'club'` must use
 * these helpers so the two tiers stay in lockstep.
 */

export const CLUB_PLANS = ["club_small", "club_large"] as const;
export type ClubPlan = (typeof CLUB_PLANS)[number];
export type OrgPlan = "free" | ClubPlan;

/**
 * True for any club tier (`club_small` or `club_large`). `free`, `null`,
 * `undefined`, and the retired legacy `'club'` value all return false.
 */
export function isClubPlan(plan: string | null | undefined): plan is ClubPlan {
  return plan === "club_small" || plan === "club_large";
}

/**
 * Subscription statuses that grant club portal access. `past_due` retains
 * access so the owner has time to resolve a failed payment before features are
 * revoked; `canceled` (and `null`) do not.
 */
export const CLUB_ACCESS_STATUSES = ["trialing", "active", "past_due"] as const;

/**
 * Compound club-dashboard access gate. Both conditions must hold: the org is on
 * a club tier AND its subscription_status grants access. Neither alone is
 * sufficient — a `free` org with a stale `trialing` status, or a `club_*` org
 * that is `canceled`, must be denied.
 */
export function hasClubAccess(
  plan: string | null | undefined,
  subscriptionStatus: string | null | undefined,
): boolean {
  return (
    isClubPlan(plan) &&
    (CLUB_ACCESS_STATUSES as readonly string[]).includes(
      subscriptionStatus ?? "",
    )
  );
}
