/**
 * Core logic for creating a team via POST /api/teams.
 * Extracted from CreateTeamForm to enable unit testing without DOM/RTL.
 *
 * Both call sites — the standalone /create-team page and the TeamSwitcher
 * dialog — use this function, making it the single source of truth for
 * the active-profile cookie-reset requirement (§4.6 of the test plan).
 */
export async function executeCreateTeam({
  teamName,
  season,
  orgName,
  fetchFn = fetch,
  clearActiveProfileFn,
  onSuccess,
  routerPush,
  routerRefresh,
}: {
  teamName: string;
  season?: string;
  orgName?: string;
  /** Overridable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  clearActiveProfileFn: () => Promise<void>;
  onSuccess?: () => void;
  routerPush?: (path: string) => void;
  routerRefresh?: () => void;
}): Promise<string | null> {
  const res = await fetchFn("/api/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teamName,
      season: season || undefined,
      orgName: orgName || undefined,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return (data as { error?: string }).error ?? "Something went wrong. Please try again.";
  }

  // Always clear the managed-profile cookie on success — including the
  // TeamSwitcher path (onSuccess provided). A stale active_profile_id
  // would cause the dashboard to resolve a managed profile that has no
  // membership on the new team (§4.6.2).
  await clearActiveProfileFn();

  if (onSuccess) {
    onSuccess();
  } else {
    routerPush?.("/dashboard");
    routerRefresh?.();
  }

  return null;
}
