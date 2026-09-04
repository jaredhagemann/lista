/**
 * Tests for LogSessionDialog's coach mode (docs/specs/coach-log-training.md §5a):
 * a coach logs for a selected roster player. Covers the player selector, the
 * absence of the team selector, the relaxed date floor, subject-based insert,
 * and the "pick a player" guard.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn((_payload: Record<string, unknown>) => Promise.resolve({ error: null })),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: h.toastError, success: h.toastSuccess }),
}));

vi.mock("@/lib/supabase/client", () => {
  const cats = [
    { id: "cat-1", label: "General", is_default: true, sort_order: 0, is_active: true, created_at: "" },
  ];
  const client = {
    from: (table: string) => {
      if (table === "training_categories") {
        return {
          select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: cats }) }) }),
        };
      }
      // training_sessions
      return {
        insert: h.insert,
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
  return { createClient: () => client };
});

import { LogSessionDialog } from "@/components/training/log-session-dialog";

const TEAM = { id: "team-1", name: "Dev FC", timezone: "UTC" };
const PLAYERS = [
  { id: "p1", name: "Ava Nguyen" },
  { id: "p2", name: "Liam Ortiz" },
];

function base(extra: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    profileId: "coach-self",
    eligibleTeams: [TEAM],
    defaultTeamId: TEAM.id,
    timezone: "UTC",
    onSaved: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogSessionDialog — coach mode", () => {
  it("shows the coach title and a Player selector, and hides the Team selector", () => {
    render(
      <LogSessionDialog
        {...base({ players: PLAYERS, eligibleTeams: [TEAM, { id: "t2", name: "B", timezone: "UTC" }] })}
      />,
    );
    expect(screen.getByText("Log for a player")).toBeTruthy();
    expect(screen.getByText("Player")).toBeTruthy();
    // Team selector is suppressed in coach mode even with >1 eligible team.
    expect(screen.queryByText("Team")).toBeNull();
  });

  it("relaxes the date floor: no min, max = today (self-log keeps the 7-day floor)", () => {
    const { unmount } = render(<LogSessionDialog {...base({ players: PLAYERS })} />);
    const coachDate = document.getElementById("session-date") as HTMLInputElement;
    expect(coachDate.getAttribute("min")).toBeNull();
    expect(coachDate.getAttribute("max")).toBe(coachDate.value); // max === today
    unmount();

    // Self-log mode (no players) still enforces the 7-day floor.
    render(<LogSessionDialog {...base()} />);
    const selfDate = document.getElementById("session-date") as HTMLInputElement;
    expect(selfDate.getAttribute("min")).not.toBeNull();
  });

  it("inserts with the preselected player's id as profile_id", async () => {
    render(<LogSessionDialog {...base({ players: PLAYERS, playerId: "p1" })} />);
    const user = userEvent.setup();

    // Flush the async category-load effect so the default category is selected
    // (otherwise handleSave would stop at the "pick a category" guard).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await user.click(screen.getByRole("button", { name: /log session/i }));

    await waitFor(() => expect(h.insert).toHaveBeenCalledTimes(1));
    const payload = h.insert.mock.calls[0][0];
    expect(payload.profile_id).toBe("p1");
    expect(payload.team_id).toBe("team-1");
  });

  it("blocks saving with no player chosen", async () => {
    render(<LogSessionDialog {...base({ players: PLAYERS })} />); // no playerId
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /log session/i }));

    expect(h.toastError).toHaveBeenCalledWith("Pick a player.");
    expect(h.insert).not.toHaveBeenCalled();
  });
});
