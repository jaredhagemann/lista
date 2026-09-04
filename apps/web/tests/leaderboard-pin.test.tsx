/**
 * Tests for the leaderboard's "pin the current user's row into view" behavior.
 *
 * Spec (individual-training-tracking.md §"Leaderboard"): "The current user's row
 * is highlighted and pinned into view if they're below the fold." The row is
 * always highlighted; this suite covers the pinning — a sticky copy of the self
 * row that appears only while the real row is scrolled below the fold.
 *
 * IntersectionObserver and the Supabase client are both mocked so the pin logic
 * can be driven deterministically in jsdom.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted shared state for the mocks ──────────────────────────────────────
const h = vi.hoisted(() => ({
  boardRows: [] as unknown[],
  summaryRow: null as unknown,
  ioInstances: [] as { cb: (entries: unknown[]) => void }[],
}));

// A STABLE singleton client, mirroring @supabase/ssr's createBrowserClient. A
// fresh object per call would change the component's `supabase` identity on
// every render, re-triggering its load effect — an artifact that would mask the
// pin behavior under test.
vi.mock("@/lib/supabase/client", () => {
  const client = {
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "training_leaderboard"
          ? { data: h.boardRows, error: null }
          : { data: [h.summaryRow], error: null },
      ),
  };
  return { createClient: () => client };
});

class MockIntersectionObserver {
  cb: (entries: unknown[]) => void;
  constructor(cb: (entries: unknown[]) => void) {
    this.cb = cb;
    h.ioInstances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

import { LeaderboardTab, isSelfBelowFold } from "@/components/training/leaderboard-tab";
import type { TrainingViewProps } from "@/components/training/training-view";

const SELF_ID = "self-profile-id";

function makeRows() {
  // 15 rows with the self row at rank 12 (below the fold on any short viewport).
  return Array.from({ length: 15 }, (_, i) => {
    const rank = i + 1;
    const isSelf = rank === 12;
    return {
      profile_id: isSelf ? SELF_ID : `p-${rank}`,
      display_name: isSelf ? "Me Myself" : `Player ${rank}`,
      avatar_url: null,
      team_id: "team-1",
      team_name: "Dev FC",
      total_minutes: 200 - rank * 5,
      session_count: 3,
      rank,
    };
  });
}

const baseProps: TrainingViewProps & { onGoToMyTraining: () => void } = {
  viewerId: SELF_ID,
  activeProfile: { id: SELF_ID, firstName: "Me", lastName: "Myself", optedOut: false },
  activeTeam: { id: "team-1", name: "Dev FC", timezone: "UTC", sport: "soccer" },
  org: { id: "org-1", name: "Dev Club" },
  isTeamAdmin: false,
  eligibleTeams: [],
  orgTeams: [],
  onGoToMyTraining: () => {},
};

beforeEach(() => {
  h.boardRows = [];
  h.summaryRow = null;
  h.ioInstances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

// ── Pure decision helper ────────────────────────────────────────────────────

describe("isSelfBelowFold()", () => {
  it("is true when the row is off-screen with its top below the viewport", () => {
    expect(isSelfBelowFold({ isIntersecting: false, boundingClientRect: { top: 900 } })).toBe(true);
  });

  it("is false when the row is intersecting the viewport", () => {
    expect(isSelfBelowFold({ isIntersecting: true, boundingClientRect: { top: 900 } })).toBe(false);
  });

  it("is false when the row is scrolled off the TOP (already seen)", () => {
    expect(isSelfBelowFold({ isIntersecting: false, boundingClientRect: { top: -120 } })).toBe(false);
  });
});

// ── Pinned-row behavior ─────────────────────────────────────────────────────

describe("LeaderboardTab — pinned self row", () => {
  function fireIntersection(entry: { isIntersecting: boolean; boundingClientRect: { top: number } }) {
    act(() => {
      h.ioInstances.forEach((io) => io.cb([entry]));
    });
  }

  it("does not pin while the self row is in view (only the list badge shows)", async () => {
    h.boardRows = makeRows();
    h.summaryRow = { total_minutes: 140, session_count: 3, rank: 12, denominator: 15 };

    render(<LeaderboardTab {...baseProps} />);
    await screen.findByText("Me Myself");

    fireIntersection({ isIntersecting: true, boundingClientRect: { top: 400 } });

    // Just the one "You" badge in the ranked list — no pinned copy.
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("pins a copy of the self row when it falls below the fold", async () => {
    h.boardRows = makeRows();
    h.summaryRow = { total_minutes: 140, session_count: 3, rank: 12, denominator: 15 };

    render(<LeaderboardTab {...baseProps} />);
    await screen.findByText("Me Myself");

    fireIntersection({ isIntersecting: false, boundingClientRect: { top: 900 } });

    // Two "You" badges now: the real list row + the pinned copy.
    await waitFor(() => expect(screen.getAllByText("You")).toHaveLength(2));
  });

  it("removes the pinned copy once the self row scrolls back into view", async () => {
    h.boardRows = makeRows();
    h.summaryRow = { total_minutes: 140, session_count: 3, rank: 12, denominator: 15 };

    render(<LeaderboardTab {...baseProps} />);
    await screen.findByText("Me Myself");

    fireIntersection({ isIntersecting: false, boundingClientRect: { top: 900 } });
    await waitFor(() => expect(screen.getAllByText("You")).toHaveLength(2));

    fireIntersection({ isIntersecting: true, boundingClientRect: { top: 300 } });
    await waitFor(() => expect(screen.getAllByText("You")).toHaveLength(1));
  });

  it("never pins when the current user is absent from the board (e.g. opted out)", async () => {
    // No self row in the board data.
    h.boardRows = makeRows().filter((r) => r.profile_id !== SELF_ID);
    h.summaryRow = { total_minutes: 0, session_count: 0, rank: null, denominator: 15 };

    render(<LeaderboardTab {...baseProps} />);
    await screen.findByText("Player 1");

    // Even if an observer somehow fires below-fold, there is nothing to pin.
    fireIntersection({ isIntersecting: false, boundingClientRect: { top: 900 } });

    expect(screen.queryByText("You")).toBeNull();
  });
});
