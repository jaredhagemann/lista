/**
 * Unit tests for the iOS CreateTeamScreen submit logic.
 *
 * Covers test-plan sections:
 *   §5.5  — Successful creation: this phone saved on the new team, refresh, navigate
 *   §5.8  — Failure: inline error shown, no navigation
 *   §5.9.2 — Whatever was active, the new team is saved before refresh
 *            (device-local-active-context, D5)
 *   §5.9.4 — Failure leaves the saved context untouched
 * And review findings:
 *   DC-004 — a landing the phone couldn't save says so; retrying repeats only
 *            the local save, never the creation
 *   DC-005 — the response lands on the account that asked, and nowhere if the
 *            signed-in account changed meanwhile
 *
 * All dependencies are injected so no React Native environment is needed.
 */

import { executeCreateTeamMobile, type CreateTeamMobileDeps } from "../lib/create-team";

const API_BASE = "https://lista.team";
const A = "00000000-0000-4000-8000-00000000000a";

function okResponse(body: unknown = { teamId: "team-abc" }): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function errResponse(body: unknown = { error: "internal error" }, status = 500): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let deps: { [K in keyof Required<CreateTeamMobileDeps>]: jest.Mock };
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  deps = {
    fetchFn: jest.fn().mockResolvedValue(okResponse()),
    getAccount: jest.fn().mockResolvedValue({ accessToken: "token-a", accountId: A }),
    isCurrentAccount: jest.fn().mockResolvedValue(true),
    landOnTeam: jest.fn().mockImplementation(async () => (calls.push("landOnTeam"), true)),
    reportLandingFailed: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockImplementation(async () => void calls.push("refresh")),
    routerReplace: jest.fn().mockImplementation(() => void calls.push("routerReplace")),
  };
});

const create = (teamName = "U12 Boys") => executeCreateTeamMobile({ teamName }, deps as unknown as CreateTeamMobileDeps, API_BASE);

describe("executeCreateTeamMobile — success (§5.5, §5.9.2)", () => {
  it("lands this phone on the new team, as the account that asked, then refreshes and navigates", async () => {
    expect(await create()).toBeNull();

    expect(deps.landOnTeam).toHaveBeenCalledWith(A, "team-abc");
    expect(calls).toEqual(["landOnTeam", "refresh", "routerReplace"]);
    expect(deps.routerReplace).toHaveBeenCalledWith("/(app)");
  });

  it("sends that account's Bearer token", async () => {
    await create();

    const [url, init] = deps.fetchFn.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/teams`);
    expect(init.headers.Authorization).toBe("Bearer token-a");
  });

  it("a response without a teamId lands nowhere, but still refreshes", async () => {
    deps.fetchFn.mockResolvedValue(okResponse({}));

    expect(await create()).toBeNull();
    expect(deps.landOnTeam).not.toHaveBeenCalled();
    expect(deps.refresh).toHaveBeenCalled();
  });
});

describe("executeCreateTeamMobile — failure (§5.8, §5.9.4)", () => {
  it("a 500 shows its error, and lands nowhere", async () => {
    deps.fetchFn.mockResolvedValue(errResponse({ error: "internal error" }, 500));

    expect(await create()).toBe("internal error");
    expect(deps.landOnTeam).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.routerReplace).not.toHaveBeenCalled();
  });

  it("a 400 too", async () => {
    deps.fetchFn.mockResolvedValue(errResponse({ error: "teamName is required" }, 400));

    expect(await create("")).toBe("teamName is required");
    expect(deps.landOnTeam).not.toHaveBeenCalled();
  });

  it("not signed in: an error, and no request", async () => {
    deps.getAccount.mockResolvedValue(null);

    expect(await create()).toBe("Not signed in. Please restart the app.");
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

describe("DC-005: the response belongs to the account that asked", () => {
  it("another account signed in meanwhile: nothing lands, refreshes or navigates", async () => {
    deps.isCurrentAccount.mockResolvedValue(false);

    expect(await create()).toBeNull();
    expect(deps.isCurrentAccount).toHaveBeenCalledWith(A);
    expect(deps.landOnTeam).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.routerReplace).not.toHaveBeenCalled();
  });
});

describe("DC-004: a landing the phone couldn't save", () => {
  it("says so; retrying repeats only the save, and the team is created once", async () => {
    deps.landOnTeam.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    deps.reportLandingFailed.mockImplementation(async (retry: () => Promise<boolean>) => {
      expect(await retry()).toBe(true);
    });

    expect(await create()).toBeNull();

    expect(deps.reportLandingFailed).toHaveBeenCalledTimes(1);
    expect(deps.landOnTeam).toHaveBeenCalledTimes(2);
    expect(deps.landOnTeam).toHaveBeenLastCalledWith(A, "team-abc");
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(deps.refresh).toHaveBeenCalled();
  });

  it("a landing that saved reports nothing", async () => {
    await create();
    expect(deps.reportLandingFailed).not.toHaveBeenCalled();
  });
});
