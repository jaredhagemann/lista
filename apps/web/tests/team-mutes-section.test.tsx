// @vitest-environment jsdom
/**
 * Muting one team from Settings (docs/specs/team-notification-controls.md §3.1, §3.4).
 *
 * One switch per team the person hears from, on when the team isn't muted.
 * Turning it off mutes email and push together (D1); turning it back on
 * removes the mute. Each switch saves as it's flipped, and a failed save puts
 * it back. The email footer's "Mute [Team]" link highlights that team.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const calls: Array<{ op: string; values?: unknown; filters?: Record<string, unknown> }> = [];
  const state = { error: null as { message: string } | null, hold: false };
  // With hold on, each save waits until the test settles it, oldest first or not.
  const pending: Array<{ teamId: unknown; settle: (error?: { message: string }) => void }> = [];
  const result = (teamId: unknown) =>
    state.hold
      ? new Promise<{ error: { message: string } | null }>((resolve) =>
          pending.push({ teamId, settle: (error) => resolve({ error: error ?? null }) })
        )
      : Promise.resolve({ error: state.error });
  const deleteChain = (filters: Record<string, unknown>) => ({
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      if (Object.keys(filters).length < 2) return deleteChain(filters);
      calls.push({ op: "delete", filters });
      return result(filters.team_id);
    },
  });
  return {
    calls,
    state,
    pending,
    toast: { success: vi.fn(), error: vi.fn() },
    client: {
      from: (table: string) => ({
        upsert: (values: unknown) => {
          calls.push({ op: `upsert:${table}`, values });
          return result((values as { team_id: string }).team_id);
        },
        delete: () => {
          calls.push({ op: `delete-start:${table}` });
          return deleteChain({});
        },
      }),
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { TeamMutesSection } from "@/components/settings/team-mutes-section";

const ME = "me-1";
const TEAMS = [
  { id: "team-a", name: "U10 Girls", isAdmin: false },
  { id: "team-b", name: "U12 Boys", isAdmin: true },
];

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.state.error = null;
  mocks.state.hold = false;
  mocks.pending.length = 0;
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function teamSwitch(name: string) {
  return screen.getByRole("switch", { name: `Notifications from ${name}` });
}

describe("team mutes in Settings", () => {
  it("shows one switch per team, off for a muted team", () => {
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={["team-b"]} />);

    expect(teamSwitch("U10 Girls").getAttribute("aria-checked")).toBe("true");
    expect(teamSwitch("U12 Boys").getAttribute("aria-checked")).toBe("false");
  });

  it("mutes email and push together when a team is turned off", async () => {
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={[]} />);

    fireEvent.click(teamSwitch("U10 Girls"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        op: "upsert:team_notification_mutes",
        values: { profile_id: ME, team_id: "team-a", email_muted: true, push_muted: true },
      })
    );
    expect(teamSwitch("U10 Girls").getAttribute("aria-checked")).toBe("false");
  });

  it("removes the mute when a team is turned back on", async () => {
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={["team-a"]} />);

    fireEvent.click(teamSwitch("U10 Girls"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        op: "delete",
        filters: { profile_id: ME, team_id: "team-a" },
      })
    );
    expect(teamSwitch("U10 Girls").getAttribute("aria-checked")).toBe("true");
  });

  it("puts the switch back and says so when the save fails", async () => {
    mocks.state.error = { message: "permission denied" };
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={[]} />);

    fireEvent.click(teamSwitch("U10 Girls"));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(teamSwitch("U10 Girls").getAttribute("aria-checked")).toBe("true");
  });

  // Team-mute review TM-001: one team's save finishing never frees another's switch.
  it("keeps each team's switch disabled until its own save finishes, in either order", async () => {
    mocks.state.hold = true;
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={[]} />);
    const settle = async (teamId: string, error?: { message: string }) => {
      const i = mocks.pending.findIndex((p) => p.teamId === teamId);
      await act(async () => mocks.pending.splice(i, 1)[0].settle(error));
    };
    const disabled = (name: string) => teamSwitch(name).hasAttribute("disabled");

    fireEvent.click(teamSwitch("U10 Girls"));
    fireEvent.click(teamSwitch("U12 Boys"));
    expect(disabled("U10 Girls")).toBe(true);
    expect(disabled("U12 Boys")).toBe(true);

    // A second click on a team still saving starts nothing.
    fireEvent.click(teamSwitch("U10 Girls"));
    expect(mocks.calls.filter((c) => c.op.startsWith("upsert"))).toHaveLength(2);
    expect(mocks.calls.some((c) => c.op.startsWith("delete"))).toBe(false);

    await settle("team-b");
    expect(disabled("U10 Girls")).toBe(true);
    expect(disabled("U12 Boys")).toBe(false);
    expect(teamSwitch("U12 Boys").getAttribute("aria-checked")).toBe("false");

    await settle("team-a", { message: "permission denied" });
    expect(disabled("U10 Girls")).toBe(false);
    expect(teamSwitch("U10 Girls").getAttribute("aria-checked")).toBe("true");
  });

  it("warns a coach or manager that muting hides what their team is sent", () => {
    render(<TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={[]} />);

    const notes = screen.getAllByText(/you won't see the reminders and notices your team gets/);
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("[data-team-id]")?.getAttribute("data-team-id")).toBe("team-b");
  });

  it("highlights the team an email's mute link named, and scrolls to it", () => {
    render(
      <TeamMutesSection profileId={ME} teams={TEAMS} mutedTeamIds={[]} highlightTeamId="team-b" />
    );

    const row = teamSwitch("U12 Boys").closest("[data-team-id]")!;
    expect(row.getAttribute("data-highlighted")).toBe("true");
    expect(teamSwitch("U10 Girls").closest("[data-team-id]")!.getAttribute("data-highlighted")).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("says so when the person isn't on any team", () => {
    render(<TeamMutesSection profileId={ME} teams={[]} mutedTeamIds={[]} />);

    expect(screen.getByText("You're not on any teams yet.")).toBeTruthy();
  });
});
