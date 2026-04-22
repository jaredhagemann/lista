import Stripe from "stripe";

/**
 * Shared Stripe client instance.
 * Extracted to a separate module so tests can mock via vi.mock("@/lib/stripe").
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
