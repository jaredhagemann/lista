import Stripe from "stripe";

/**
 * Returns a Stripe client instance.
 * Extracted to a separate module so tests can mock via vi.mock("@/lib/stripe").
 * Factory function (not a top-level singleton) so Next.js build-time module
 * evaluation doesn't throw when STRIPE_SECRET_KEY is absent.
 */
export function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}
