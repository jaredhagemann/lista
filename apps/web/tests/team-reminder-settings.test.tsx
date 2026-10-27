// @vitest-environment jsdom
/**
 * A team's reminder settings, on Settings → Team (team-notification-controls §4.1).
 *
 * One switch for the team, and one per event type. Each saves as it's flipped
 * (the whole row, so a first save creates it). The type switches only matter
 * while reminders are on. Members who can't edit events see them read-only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const calls: Array<{ table: string; values: unknown }> = [];
  const state = { error: null as { message: string } | null };
  return {
    calls,
    state,
    toast: { success: vi.fn(), error: vi.fn() },
    client: {
      from: (table: string) => ({
        upsert: (values: unknown) => {
          calls.push({ table, values });
          return Promise.resolve({ error: state.error });
        },
      }),
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { TeamReminderSettings } from "@/components/settings/team-reminder-settings";

const ALL_ON = { enabled: true, remind_practice: true, remind_game: true, remind_other: true, remind_tournament: true };

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.state.error = null;
  vi.clearAllMocks();
});

afterEach(cleanup);

const sw = (name: string) => screen.getByRole("switch", { name });
const checked = (name: string) => sw(name).getAttribute("aria-checked") === "true";

describe("team reminder settings", () => {
  it("shows the defaults, all on, for a team with no settings yet, and says when reminders go out", () => {
    render(<TeamReminderSettings teamId="team-1" settings={null} canEdit />);

    for (const name of ["Send reminders", "Practices", "Games", "Other events", "Tournaments"]) {
      expect(checked(name)).toBe(true);
    }
    expect(screen.getByText("Reminders are sent once a day, for events in the next 24 hours.")).toBeTruthy();
    expect(screen.getByText(/Tournament games follow the Games setting/)).toBeTruthy();
  });

  it("saves the whole row as soon as a switch is flipped", async () => {
    render(<TeamReminderSettings teamId="team-1" settings={null} canEdit />);

    fireEvent.click(sw("Games"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        table: "team_reminder_settings",
        values: { team_id: "team-1", ...ALL_ON, remind_game: false },
      })
    );
    expect(checked("Games")).toBe(false);
  });

  it("turning reminders off leaves the types as they were, but not editable", async () => {
    render(<TeamReminderSettings teamId="team-1" settings={{ ...ALL_ON, remind_other: false }} canEdit />);

    fireEvent.click(sw("Send reminders"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        table: "team_reminder_settings",
        values: { team_id: "team-1", ...ALL_ON, enabled: false, remind_other: false },
      })
    );
    expect(sw("Practices").hasAttribute("disabled")).toBe(true);
    expect(checked("Other events")).toBe(false);
  });

  it("puts a switch back and says so when the save fails", async () => {
    mocks.state.error = { message: "permission denied" };
    render(<TeamReminderSettings teamId="team-1" settings={null} canEdit />);

    fireEvent.click(sw("Practices"));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(checked("Practices")).toBe(true);
  });

  it("is read-only for members who can't edit events", () => {
    render(<TeamReminderSettings teamId="team-1" settings={{ ...ALL_ON, remind_game: false }} canEdit={false} />);

    for (const name of ["Send reminders", "Practices", "Games", "Other events", "Tournaments"]) {
      expect(sw(name).hasAttribute("disabled")).toBe(true);
    }
    expect(checked("Games")).toBe(false);
  });
});
