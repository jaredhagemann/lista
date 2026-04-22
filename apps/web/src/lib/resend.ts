import { Resend } from "resend";

/**
 * Shared Resend client instance.
 * Extracted so tests can mock via vi.mock("@/lib/resend").
 */
export function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}
