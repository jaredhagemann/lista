/**
 * Unit tests for the CreateTeamForm submit logic.
 *
 * Covers test-plan section §4.6 — Active profile cookie reset on web.
 *
 * Tests executeCreateTeam() — the pure logic function used by both the
 * standalone /create-team page (no onSuccess) and the TeamSwitcher dialog
 * (onSuccess provided). All dependencies are injected so no DOM, jsdom,
 * or React Testing Library is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreateTeam } from "@/lib/create-team";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

// Typed mock helpers — give vi.fn() the signatures expected by executeCreateTeam
// so TypeScript is satisfied without loosening the production types.
function mockVoidFn() {
  return vi.fn() as unknown as () => void;
}
function mockAsyncVoidFn() {
  return vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>;
}
function mockRouterPushFn() {
  return vi.fn() as unknown as (path: string) => void;
}

describe("executeCreateTeam — active-profile cookie reset (§4.6)", () => {
  let clearActiveProfile: () => Promise<void>;
  let onSuccess: () => void;
  let routerPush: (path: string) => void;
  let routerRefresh: () => void;

  beforeEach(() => {
    clearActiveProfile = mockAsyncVoidFn();
    onSuccess = mockVoidFn();
    routerPush = mockRouterPushFn();
    routerRefresh = mockVoidFn();
  });

  // ── §4.6.1 — Standalone page path (no onSuccess) ─────────────────────────

  it("§4.6.1 calls clearActiveProfile on success (standalone path)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const err = await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      routerPush,
      routerRefresh,
    });
    expect(err).toBeNull();
    expect(clearActiveProfile).toHaveBeenCalledTimes(1);
  });

  it("§4.6.1 navigates to /dashboard after success (standalone path)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      routerPush,
      routerRefresh,
    });
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
    expect(routerRefresh).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ── §4.6.2 — TeamSwitcher dialog path (onSuccess provided) ───────────────

  it("§4.6.2 calls clearActiveProfile before onSuccess (switcher path)", async () => {
    const callOrder: string[] = [];
    clearActiveProfile = vi.fn().mockImplementation(async () => {
      callOrder.push("clearActiveProfile");
    }) as unknown as () => Promise<void>;
    onSuccess = vi.fn().mockImplementation(() => {
      callOrder.push("onSuccess");
    }) as unknown as () => void;

    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const err = await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      onSuccess,
    });

    expect(err).toBeNull();
    expect(callOrder).toEqual(["clearActiveProfile", "onSuccess"]);
  });

  it("§4.6.2 calls onSuccess instead of router.push in switcher path", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      onSuccess,
      routerPush,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalled();
  });

  // ── §4.6.4 — Failure path leaves cookie untouched ────────────────────────

  it("§4.6.4 does NOT call clearActiveProfile when POST returns 500", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse({ error: "internal error" }, 500));
    const err = await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      onSuccess,
      routerPush,
    });
    expect(err).toBe("internal error");
    expect(clearActiveProfile).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("§4.6.4 does NOT call clearActiveProfile when POST returns 400", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      errResponse({ error: "teamName is required" }, 400)
    );
    const err = await executeCreateTeam({
      teamName: "",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
      routerPush,
    });
    expect(err).toBe("teamName is required");
    expect(clearActiveProfile).not.toHaveBeenCalled();
  });

  it("§4.6.4 returns fallback error message when POST body is not JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    );
    const err = await executeCreateTeam({
      teamName: "U12 Boys",
      fetchFn,
      clearActiveProfileFn: clearActiveProfile,
    });
    expect(err).toBe("Something went wrong. Please try again.");
    expect(clearActiveProfile).not.toHaveBeenCalled();
  });
});
