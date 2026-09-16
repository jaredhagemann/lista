/**
 * The database refuses to remove the last guardian of a player who has no login
 * of their own (trigger `profile_managers_keep_login_path`, BUG-002). Its error
 * message starts with this marker.
 */
const LAST_GUARDIAN_MARKER = "LAST_GUARDIAN";

export const LAST_GUARDIAN_MESSAGE =
  "This player has no login of their own, so they must keep at least one guardian. Add another guardian before removing this one.";

export function isLastGuardianError(error: { message?: string } | null | undefined): boolean {
  return !!error?.message?.includes(LAST_GUARDIAN_MARKER);
}
