/**
 * Tests for the viewer-aware Leaderboard CTA (docs/specs/coach-log-training.md
 * §5c): a coach/admin who isn't a roster player sees "Log for a player →"
 * (opening the coach dialog), a player sees the self-log "Log a session →", and
 * a non-player non-admin sees no log affordance.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  board: [] as unknown[],
  summary: { total_minutes: 0, session_count: 0, rank: null, denominator: 0 } as unknown,
  roster: [] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => {
  function makeQuery(data: unknown) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lt", "order"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
    return q;
  }
  const client = {
    rpc: (fn: string) =>
      Promise.resolve(fn === "training_leaderboard" ? { data: h.board, error: null } : { data: [h.summary], error: null }),
    from: (table: string) => makeQuery(table === "team_members" ? h.roster : null),
  };
  return { createClient: () => client };
});

vi.mock("@/components/training/log-session-dialog", () => ({
  LogSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="log-dialog">dialog</div> : null),
}));

import { LeaderboardTab } from "@/components/training/leaderboard-tab";
import type { TrainingViewProps } from "@/components/training/training-view";

function props(extra: Partial<TrainingViewProps>): TrainingViewProps & { onGoToMyTraining: () => void } {
  return {
    viewerId: "v1",
    activeProfile: { id: "v1", firstName: "V", lastName: null, optedOut: false },
    activeTeam: { id: "team-1", name: "Dev FC", timezone: "UTC", sport: "soccer" },
    org: { id: "org-1", name: "Dev Club" },
    isTeamAdmin: false,
    eligibleTeams: [],
    orgTeams: [],
    onGoToMyTraining: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  h.board = [];
  h.summary = { total_minutes: 0, session_count: 0, rank: null, denominator: 0 };
  h.roster = [];
});

describe("LeaderboardTab — viewer-aware log CTA", () => {
  it("coach viewer (admin, not a player) gets 'Log for a player' and no self-log CTA", async () => {
    h.roster = [{ profiles: { id: "p1", first_name: "Ava", last_name: "Nguyen" } }];
    render(<LeaderboardTab {...props({ isTeamAdmin: true, eligibleTeams: [] })} />);
    // Flush the board + roster loads.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const btn = screen.getByRole("button", { name: /log for a player/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // roster loaded
    expect(screen.queryByText(/you haven't logged/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /log a session/i })).toBeNull();

    await userEvent.setup().click(btn);
    expect(screen.getByTestId("log-dialog")).toBeTruthy();
  });

  it("player viewer gets the self-log CTA, not the coach one", async () => {
    render(
      <LeaderboardTab
        {...props({ isTeamAdmin: false, eligibleTeams: [{ id: "team-1", name: "Dev FC", timezone: "UTC" }] })}
      />,
    );
    expect(await screen.findByRole("button", { name: /log a session/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /log for a player/i })).toBeNull();
  });

  it("non-player non-admin sees no log affordance", async () => {
    render(<LeaderboardTab {...props({ isTeamAdmin: false, eligibleTeams: [] })} />);
    expect(await screen.findByText(/no training logged this/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /log a session/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /log for a player/i })).toBeNull();
  });
});
