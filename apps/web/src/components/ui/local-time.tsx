"use client";

/**
 * Renders a formatted date/time string in the user's local timezone.
 *
 * Must be a client component — toLocaleDateString() on the server uses the
 * server's timezone (UTC on Vercel), not the viewer's timezone.
 */
export function LocalTime({
  isoString,
  options,
}: {
  isoString: string;
  options: Intl.DateTimeFormatOptions;
}) {
  return <>{new Date(isoString).toLocaleDateString("en-US", options)}</>;
}
