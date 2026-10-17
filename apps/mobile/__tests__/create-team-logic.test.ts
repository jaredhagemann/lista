/**
 * Unit tests for the iOS CreateTeamScreen submit logic.
 *
 * Covers test-plan sections:
 *   §5.5  — Successful creation: this phone saved on the new team, refresh, navigate
 *   §5.8  — Failure: inline error shown, no navigation
 *   §5.9.2 — Whatever was active, the new team is saved before refresh (D5)
 *   §5.9.4 — Failure leaves the saved context untouched
 *
 * All dependencies are injected so no React Native environment is needed.
 */

import { executeCreateTeamMobile } from "../lib/create-team";

const API_BASE = "https://lista.team";

function okResponse(body: unknown = { teamId: "team-abc" }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errResponse(body: unknown = { error: "internal error" }, status = 500): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("executeCreateTeamMobile — active context reset (§5.9)", () => {
  let getAccessToken: jest.Mock;
  let landOnTeam: jest.Mock;
  let refresh: jest.Mock;
  let routerReplace: jest.Mock;

  beforeEach(() => {
    getAccessToken = jest.fn().mockResolvedValue("valid-access-token");
    landOnTeam = jest.fn().mockResolvedValue(undefined);
    refresh = jest.fn().mockResolvedValue(undefined);
    routerReplace = jest.fn();
  });

  // §5.5 / §5.9.2 — Success path
  it("§5.5/§5.9.2 lands this phone on the new team on success (device-local-active-context, D5)", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBeNull();
    expect(landOnTeam).toHaveBeenCalledWith("team-abc");
  });

  it("§5.5 calls refresh() on success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("§5.5 navigates to /(app) on success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(routerReplace).toHaveBeenCalledWith("/(app)");
  });

  it("§5.9.2 lands on the new team before calling refresh() (ordering)", async () => {
    const callOrder: string[] = [];
    landOnTeam = jest.fn().mockImplementation(async () => {
      callOrder.push("landOnTeam");
    });
    refresh = jest.fn().mockImplementation(async () => {
      callOrder.push("refresh");
    });

    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(callOrder).toEqual(["landOnTeam", "refresh"]);
  });

  // §5.8 / §5.9.4 — Failure path
  it("§5.8/§5.9.4 does NOT land anywhere when POST returns 500", async () => {
    const fetchFn = jest.fn().mockResolvedValue(errResponse({ error: "internal error" }, 500));
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("internal error");
    expect(landOnTeam).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("§5.9.4 does NOT land anywhere when POST returns 400", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      errResponse({ error: "teamName is required" }, 400)
    );
    const err = await executeCreateTeamMobile(
      { teamName: "" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("teamName is required");
    expect(landOnTeam).not.toHaveBeenCalled();
  });

  // No-token guard
  it("returns error and does not fetch when no access token", async () => {
    getAccessToken = jest.fn().mockResolvedValue(null);
    const fetchFn = jest.fn();
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("Not signed in. Please restart the app.");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(landOnTeam).not.toHaveBeenCalled();
  });

  it("a response without a teamId lands nowhere, but still refreshes", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse({}));
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBeNull();
    expect(landOnTeam).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("sends Bearer token in Authorization header", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, landOnTeam, refresh, routerReplace },
      API_BASE
    );
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer valid-access-token"
    );
  });
});
