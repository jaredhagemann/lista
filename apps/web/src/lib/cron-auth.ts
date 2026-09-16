/**
 * Returns true if the request carries the Vercel cron secret.
 *
 * Cron routes are exempt from the session middleware's login redirect (Vercel
 * cron sends no cookie and does not follow redirects), so this check is their
 * only protection.
 *
 * An unset or empty CRON_SECRET rejects every request. Comparing against
 * `Bearer ${process.env.CRON_SECRET}` directly would accept the literal header
 * "Bearer undefined" on any deployment missing the variable.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
