/**
 * Core logic for creating a team from the iOS app via POST /api/teams.
 * Extracted from CreateTeamScreen to enable unit testing without React Native.
 *
 * Covers test-plan sections §5.5, §5.8, §5.9.2, §5.9.4.
 */
export interface CreateTeamMobileDeps {
  /** Overridable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Returns the current access token, or null if not signed in. */
  getAccessToken: () => Promise<string | null>;
  /** Deletes a key from SecureStore. */
  deleteSecureStoreKey: (key: string) => Promise<void>;
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
    getAccessToken,
    deleteSecureStoreKey,
    refresh,
    routerReplace,
  }: CreateTeamMobileDeps,
  apiBase: string
): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) {
    return "Not signed in. Please restart the app.";
  }

  const res = await fetchFn(`${apiBase}/api/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

  // Reset any active managed profile before refreshing context — the new
  // team belongs to the own profile, and a stale SecureStore entry would
  // cause the app to resolve a managed profile with no membership on the
  // new team (§5.9.2).
  await deleteSecureStoreKey("active_profile_id");
  await refresh();
  routerReplace("/(app)");

  return null;
}
