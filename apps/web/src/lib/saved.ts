/**
 * Whether an update saved (BUG-037). PostgREST returns no error when the
 * permission rules let an update match no rows, so a refused save looks like a
 * successful one. Ask for the changed rows back (`.select("id")`) and pass the
 * result here: an error, or no row, is a failure.
 */

export const NOTHING_SAVED = "Couldn't save your changes. Refresh the page and try again.";

/** The message to show when the update didn't save, else null. */
export function saveFailure(result: {
  data: unknown[] | null;
  error: { message: string } | null;
}): string | null {
  if (result.error) return result.error.message;
  if (!result.data || result.data.length === 0) return NOTHING_SAVED;
  return null;
}
