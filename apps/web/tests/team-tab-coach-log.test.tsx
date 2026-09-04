/**
 * Tests for the coach logging entry points on the Training → Team tab
 * (docs/specs/coach-log-training.md §5b): a top-level "Log for player" button, a
 * per-roster-row "Log" action, and — in the expanded session list — an Edit
 * control that appears ONLY on sessions logged through this team, while Delete
 * appears on every row.
 *
 * LogSessionDialog is stubbed so we can assert it opens with the right
 * preselection without a real Supabase client; the data layer is mocked with a
 * thenable query-builder.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const roster = [
  {
    profiles: {
      id: "p1",
      first_name: "Ava",
      last_name: "Nguyen",
      avatar_url: null,
      training_leaderboard_opt_out: false,
    },
  },
];
const sessions = [
  { id: "s1", profile_id: "p1", session_date: "2026-09-01", duration_minutes: 30, category_id: "c1", notes: null, team_id: "team-1", training_categories: { label: "General" } },
  { id: "s2", profile_id: "p1", session_date: "2026-09-01", duration_minutes: 30, category_id: "c2", notes: null, team_id: "other-team", training_categories: { label: "Passing" } },
];

function makeQuery(data: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order", "delete"]) {
    q[m] = () => q;
  }
  q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
  return q;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) =>
      makeQuery(table === "team_members" ? roster : table === "training_sessions" ? sessions : null),
  }),
}));

vi.mock("@/components/training/log-session-dialog", () => ({
  LogSessionDialog: ({ open, playerId, session }: { open: boolean; playerId?: string; session?: unknown }) =>
    open ? (
      <div data-testid="log-dialog" data-player={playerId ?? ""} data-editing={session ? "yes" : "no"}>
        dialog
      </div>
    ) : null,
}));

import { TeamTab } from "@/components/training/team-tab";

const props = {
  viewerId: "coach-1",
  activeProfile: { id: "coach-1", firstName: "Coach", lastName: null, optedOut: false },
  activeTeam: { id: "team-1", name: "Dev FC", timezone: "UTC", sport: "soccer" as const },
  org: { id: "org-1", name: "Dev Club" },
  isTeamAdmin: true,
  eligibleTeams: [],
  orgTeams: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TeamTab — coach logging entry points", () => {
  it("shows a top-level 'Log for player' button and a per-row 'Log' action", async () => {
    render(<TeamTab {...props} />);
    await screen.findByText("Ava Nguyen");

    expect(screen.getByRole("button", { name: /log for player/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Log$/ })).toBeTruthy(); // the per-row action
  });

  it("opens the dialog with no preselected player from the top-level button", async () => {
    render(<TeamTab {...props} />);
    await screen.findByText("Ava Nguyen");
    await userEvent.setup().click(screen.getByRole("button", { name: /log for player/i }));

    const dialog = screen.getByTestId("log-dialog");
    expect(dialog.getAttribute("data-player")).toBe("");
    expect(dialog.getAttribute("data-editing")).toBe("no");
  });

  it("opens the dialog preselected to the player from the per-row 'Log' action", async () => {
    render(<TeamTab {...props} />);
    await screen.findByText("Ava Nguyen");
    await userEvent.setup().click(screen.getByRole("button", { name: /^Log$/ }));

    expect(screen.getByTestId("log-dialog").getAttribute("data-player")).toBe("p1");
  });

  it("offers Edit only for this-team sessions, Delete for all", async () => {
    render(<TeamTab {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Ava/i })); // expand the row

    // Two sessions shown (this-team + other-team): Delete on both, Edit on one.
    expect(screen.getAllByLabelText("Delete entry")).toHaveLength(2);
    expect(screen.getAllByLabelText("Edit entry")).toHaveLength(1);
  });

  it("opens the dialog in edit mode from the this-team session's Edit control", async () => {
    render(<TeamTab {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Ava/i }));
    await user.click(screen.getByLabelText("Edit entry"));

    const dialog = screen.getByTestId("log-dialog");
    expect(dialog.getAttribute("data-editing")).toBe("yes");
    expect(dialog.getAttribute("data-player")).toBe("p1");
  });
});
