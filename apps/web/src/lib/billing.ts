/**
 * Billing / Stripe price-tier mapping — single source of truth for translating
 * between club tiers (`club_small` / `club_large`) and Stripe price IDs, and
 * for the per-tier `team_limit` value that must be written on every plan
 * transition.
 *
 * Spec: `docs/specs/club-upgrade-monetization.md` → "Stripe Integration →
 * Products & Prices" and "Database Changes" (team_limit semantics).
 *
 * Reused by: `POST /api/billing/create-checkout`, `POST /api/billing/change-plan`,
 * `POST /api/billing/webhook` (price-ID → plan branching in
 * `checkout.session.completed` and `customer.subscription.updated`), and
 * `POST /api/cron/trial-expiration` (conversion path).
 */
import type { ClubPlan, OrgPlan } from "@/lib/plan";

/** Free plan team cap. Backfilled by migration 20260519000000. */
export const FREE_TEAM_LIMIT = 1;
/** Club Small team cap. */
export const CLUB_SMALL_TEAM_LIMIT = 10;

/**
 * Team limit for a given plan. `null` means unlimited (`club_large`).
 *
 * This is the value that must be written to `organizations.team_limit` on every
 * plan transition (start-trial, admin-upgrade, webhook tier change, schedule
 * release, downgrade). Keeping it in one place ensures both tiers stay in
 * lockstep with the spec.
 */
export function teamLimitForPlan(plan: OrgPlan): number | null {
  if (plan === "free") return FREE_TEAM_LIMIT;
  if (plan === "club_small") return CLUB_SMALL_TEAM_LIMIT;
  return null; // club_large → unlimited
}

/**
 * Returns the Stripe price ID configured for the given club tier.
 *
 * Reads the env var at call time (not module load) so:
 *   - Tests can stub each var independently via `vi.stubEnv`.
 *   - Next.js build-time module evaluation does not require these to be set.
 *
 * Throws if the matching env var is missing or empty — every caller (checkout,
 * change-plan, trial-conversion cron) requires a real price ID to function;
 * silently returning `undefined` would surface as an opaque Stripe error.
 */
export function priceIdForPlan(plan: ClubPlan): string {
  const envName =
    plan === "club_small"
      ? "STRIPE_CLUB_SMALL_PRICE_ID"
      : "STRIPE_CLUB_LARGE_PRICE_ID";
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Missing required env var ${envName}`);
  }
  return value;
}

/**
 * Reverse mapping for webhook handlers: given a Stripe price ID, return the
 * club tier and the team_limit to write. Returns `null` when:
 *   - `priceId` is null/undefined/empty
 *   - Neither configured club price matches (e.g. an event for an unrelated
 *     product, or env vars unset in this environment)
 *
 * Callers should treat `null` as "not one of our tiers" and no-op accordingly
 * — the webhook in particular must not write garbage for unknown prices.
 */
export function planFromPriceId(
  priceId: string | null | undefined,
): { plan: ClubPlan; teamLimit: number | null } | null {
  if (!priceId) return null;
  const smallId = process.env.STRIPE_CLUB_SMALL_PRICE_ID;
  const largeId = process.env.STRIPE_CLUB_LARGE_PRICE_ID;
  if (smallId && priceId === smallId) {
    return { plan: "club_small", teamLimit: CLUB_SMALL_TEAM_LIMIT };
  }
  if (largeId && priceId === largeId) {
    return { plan: "club_large", teamLimit: null };
  }
  return null;
}
