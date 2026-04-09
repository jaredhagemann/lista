/**
 * Unit tests for the iOS CreateTeamScreen submit logic.
 *
 * Covers test-plan sections:
 *   §5.5  — Successful creation: SecureStore cleared, refresh called, navigate
 *   §5.8  — Failure: inline error shown, no navigation
 *   §5.9.2 — Managed profile active → SecureStore key deleted before refresh
 *   §5.9.4 — Failure leaves SecureStore untouched
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
  let deleteSecureStoreKey: jest.Mock;
  let refresh: jest.Mock;
  let routerReplace: jest.Mock;

  beforeEach(() => {
    getAccessToken = jest.fn().mockResolvedValue("valid-access-token");
    deleteSecureStoreKey = jest.fn().mockResolvedValue(undefined);
    refresh = jest.fn().mockResolvedValue(undefined);
    routerReplace = jest.fn();
  });

  // §5.5 / §5.9.2 — Success path
  it("§5.5/§5.9.2 deletes SecureStore active_profile_id key on success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBeNull();
    expect(deleteSecureStoreKey).toHaveBeenCalledWith("active_profile_id");
  });

  it("§5.5 calls refresh() on success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("§5.5 navigates to /(app) on success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(routerReplace).toHaveBeenCalledWith("/(app)");
  });

  it("§5.9.2 deletes SecureStore key before calling refresh() (ordering)", async () => {
    const callOrder: string[] = [];
    deleteSecureStoreKey = jest.fn().mockImplementation(async () => {
      callOrder.push("deleteSecureStoreKey");
    });
    refresh = jest.fn().mockImplementation(async () => {
      callOrder.push("refresh");
    });

    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(callOrder).toEqual(["deleteSecureStoreKey", "refresh"]);
  });

  // §5.8 / §5.9.4 — Failure path
  it("§5.8/§5.9.4 does NOT delete SecureStore key when POST returns 500", async () => {
    const fetchFn = jest.fn().mockResolvedValue(errResponse({ error: "internal error" }, 500));
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("internal error");
    expect(deleteSecureStoreKey).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("§5.9.4 does NOT delete SecureStore key when POST returns 400", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      errResponse({ error: "teamName is required" }, 400)
    );
    const err = await executeCreateTeamMobile(
      { teamName: "" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("teamName is required");
    expect(deleteSecureStoreKey).not.toHaveBeenCalled();
  });

  // No-token guard
  it("returns error and does not fetch when no access token", async () => {
    getAccessToken = jest.fn().mockResolvedValue(null);
    const fetchFn = jest.fn();
    const err = await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    expect(err).toBe("Not signed in. Please restart the app.");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deleteSecureStoreKey).not.toHaveBeenCalled();
  });

  it("sends Bearer token in Authorization header", async () => {
    const fetchFn = jest.fn().mockResolvedValue(okResponse());
    await executeCreateTeamMobile(
      { teamName: "U12 Boys" },
      { fetchFn, getAccessToken, deleteSecureStoreKey, refresh, routerReplace },
      API_BASE
    );
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer valid-access-token"
    );
  });
});
