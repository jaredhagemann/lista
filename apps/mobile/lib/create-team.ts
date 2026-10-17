/**
 * Core logic for creating a team from the iOS app via POST /api/teams.
 * Extracted from CreateTeamScreen to enable unit testing without React Native.
 *
 * Covers test-plan sections §5.5, §5.8, §5.9.2, §5.9.4, and review findings
 * DC-004 and DC-005 (docs/reviews/2026-10-16-device-local-active-context-review.md).
 */
export interface CreateTeamMobileDeps {
  /** Overridable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /**
   * The signed-in account and its access token, read together before the
   * request, so the response is tied to the account that asked (DC-005).
   */
  getAccount: () => Promise<{ accessToken: string; accountId: string } | null>;
  /** Whether that account is still the signed-in one when the response arrives. */
  isCurrentAccount: (accountId: string) => Promise<boolean>;
  /**
   * Saves this phone's context on the new team, as the account's own profile
   * (device-local-active-context, D5). False if the phone couldn't save it.
   */
  landOnTeam: (accountId: string, teamId: string) => Promise<boolean>;
  /**
   * The team was made, but the phone couldn't switch to it: says so. `retry`
   * repeats only the local save, never the creation (DC-004).
   */
  reportLandingFailed: (retry: () => Promise<boolean>) => Promise<void>;
  /** Refreshes the AppContext membership state. */
  refresh: () => Promise<void>;
  /** Navigates to the given path (replace). */
  routerReplace: (path: string) => void;
}

export async function executeCreateTeamMobile(
  {
    teamName,
    season,
    orgName,
  }: { teamName: string; season?: string; orgName?: string },
  {
    fetchFn = fetch,
    getAccount,
    isCurrentAccount,
    landOnTeam,
    reportLandingFailed,
    refresh,
    routerReplace,
  }: CreateTeamMobileDeps,
  apiBase: string
): Promise<string | null> {
  const account = await getAccount();
  if (!account) {
    return "Not signed in. Please restart the app.";
  }

  const res = await fetchFn(`${apiBase}/api/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.accessToken}`,
    },
    body: JSON.stringify({
      teamName: teamName.trim(),
      season: season?.trim() || undefined,
      orgName: orgName?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return (data as { error?: string }).error ?? "Something went wrong. Please try again.";
  }

  // Signed out, or another account signed in, while this was on its way: the
  // new team is the asking account's, and this phone isn't showing it now.
  if (!(await isCurrentAccount(account.accountId))) return null;

  // Land on the new team before refreshing, whatever was active: it's the
  // account's own team (§5.9.2; device-local-active-context, D5).
  const { teamId } = (await res.json().catch(() => ({}))) as { teamId?: string };
  if (teamId && !(await landOnTeam(account.accountId, teamId))) {
    await reportLandingFailed(() => landOnTeam(account.accountId, teamId));
  }
  await refresh();
  routerReplace("/(app)");

  return null;
}
