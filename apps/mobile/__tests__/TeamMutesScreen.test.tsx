/**
 * Muting one team from the app's notification settings
 * (docs/specs/team-notification-controls.md §3.4, D1).
 *
 * The web's Teams section: one switch per team the person hears from, grouped by
 * club, on when the team isn't muted. Off mutes email and push together; on
 * removes the mute. Each saves as it's flipped and a failed save puts it back.
 * The account switches keep their Save button, and neither saves the other.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

type Row = Record<string, unknown>;
type Call = { op: string; table: string; values?: unknown; filters?: Record<string, unknown> };

const mockCalls: Call[] = [];
const mockMutes: Row[] = [];
const mockState: { saveError: { message: string } | null; loadError: { message: string } | null; hold: boolean } = {
  saveError: null,
  loadError: null,
  hold: false,
};
const mockPending: Array<{ teamId: unknown; settle: (error?: { message: string }) => void }> = [];
const mockGoBack = jest.fn();

jest.mock("../lib/supabase", () => {
  const save = (teamId: unknown) =>
    mockState.hold
      ? new Promise((resolve) =>
          mockPending.push({ teamId, settle: (error) => resolve({ error: error ?? null }) })
        )
      : Promise.resolve({ error: mockState.saveError });

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    let deleting = false;
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    };
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.upsert = (values: Row) => {
      mockCalls.push({ op: "upsert", table, values });
      return table === "team_notification_mutes" ? save(values.team_id) : Promise.resolve({ error: null });
    };
    chain.delete = () => {
      deleting = true;
      return chain;
    };
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (deleting) {
        mockCalls.push({ op: "delete", table, filters });
        return save(filters.team_id).then(res, rej);
      }
      const data = mockMutes.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return Promise.resolve(
        mockState.loadError ? { data: null, error: mockState.loadError } : { data, error: null }
      ).then(res, rej);
    };
    return chain;
  };
  return { supabase: { from } };
});

jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: jest.fn(), goBack: mockGoBack }),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});
jest.mock("../app/_layout", () => ({ useSession: () => ({ user: { id: "me" } }) }));

const mockCtx: { allMemberships: Row[]; loading: boolean } = { allMemberships: [], loading: false };
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import NotificationsScreen from "../app/(app)/settings/notifications";

const membership = (id: string, name: string) => ({
  profile_id: "me",
  team_id: id,
  teams: { id, name, organization_id: null, organizations: null, archived_at: null },
});

async function renderScreen() {
  render(<NotificationsScreen />);
  await screen.findByText("Teams");
}

function teamSwitch(label: string) {
  return screen.getByLabelText(`Notifications from ${label}`);
}

beforeEach(() => {
  mockCalls.length = 0;
  mockMutes.length = 0;
  mockPending.length = 0;
  mockState.saveError = null;
  mockState.loadError = null;
  mockState.hold = false;
  mockCtx.loading = false;
  mockCtx.allMemberships = [membership("team-a", "U10 Girls"), membership("team-b", "U12 Boys")];
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("team switches", () => {
  it("shows one switch per team, off for a team this person muted", async () => {
    mockMutes.push({ profile_id: "me", team_id: "team-b" });
    await renderScreen();

    expect(teamSwitch("U10 Girls").props.value).toBe(true);
    expect(teamSwitch("U12 Boys").props.value).toBe(false);
  });

  // A coach can read the team's mutes (D4), so an unfiltered read would show
  // someone else's mute as their own.
  it("ignores another member's mute of the same team", async () => {
    mockMutes.push({ profile_id: "someone-else", team_id: "team-a" });
    await renderScreen();

    expect(teamSwitch("U10 Girls").props.value).toBe(true);
  });

  it("mutes email and push together when a team is turned off, without the Save button", async () => {
    await renderScreen();

    fireEvent(teamSwitch("U10 Girls"), "valueChange", false);

    await waitFor(() =>
      expect(mockCalls).toContainEqual({
        op: "upsert",
        table: "team_notification_mutes",
        values: { profile_id: "me", team_id: "team-a", email_muted: true, push_muted: true },
      })
    );
    await waitFor(() => expect(teamSwitch("U10 Girls").props.value).toBe(false));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("removes this person's mute when a team is turned back on", async () => {
    mockMutes.push({ profile_id: "me", team_id: "team-a" });
    await renderScreen();

    fireEvent(teamSwitch("U10 Girls"), "valueChange", true);

    await waitFor(() =>
      expect(mockCalls).toContainEqual({
        op: "delete",
        table: "team_notification_mutes",
        filters: { profile_id: "me", team_id: "team-a" },
      })
    );
    await waitFor(() => expect(teamSwitch("U10 Girls").props.value).toBe(true));
  });

  it("puts the switch back and says so when the save fails", async () => {
    mockState.saveError = { message: "permission denied" };
    await renderScreen();

    fireEvent(teamSwitch("U10 Girls"), "valueChange", false);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(teamSwitch("U10 Girls").props.value).toBe(true);
  });

  // Team-mute review TM-001: one team's save finishing never frees another's switch.
  it("keeps each team's switch disabled until its own save finishes", async () => {
    mockState.hold = true;
    await renderScreen();
    const disabled = (label: string) => teamSwitch(label).props.disabled;
    const settle = async (teamId: string, error?: { message: string }) => {
      const i = mockPending.findIndex((p) => p.teamId === teamId);
      await act(async () => mockPending.splice(i, 1)[0].settle(error));
    };

    fireEvent(teamSwitch("U10 Girls"), "valueChange", false);
    fireEvent(teamSwitch("U12 Boys"), "valueChange", false);
    expect(disabled("U10 Girls")).toBe(true);
    expect(disabled("U12 Boys")).toBe(true);

    await settle("team-b");
    expect(disabled("U10 Girls")).toBe(true);
    expect(disabled("U12 Boys")).toBe(false);
    expect(teamSwitch("U12 Boys").props.value).toBe(false);

    await settle("team-a", { message: "permission denied" });
    expect(disabled("U10 Girls")).toBe(false);
    expect(teamSwitch("U10 Girls").props.value).toBe(true);
  });

  // All on would say nothing is muted when that isn't known.
  it("shows no switches when the mutes can't be read", async () => {
    mockState.loadError = { message: "network down" };
    await renderScreen();

    expect(screen.getByText("Couldn't load your teams. Go back and try again.")).toBeTruthy();
    expect(screen.queryByLabelText("Notifications from U10 Girls")).toBeNull();
  });

  it("says so when the person isn't on any team", async () => {
    mockCtx.allMemberships = [];
    await renderScreen();

    expect(screen.getByText("You're not on any teams yet.")).toBeTruthy();
  });
});

describe("the layout", () => {
  it("groups club teams under their club, then the other teams", async () => {
    mockCtx.allMemberships = [
      membership("t-rec", "Rec Tuesdays"),
      {
        profile_id: "me",
        team_id: "t-u10",
        teams: {
          id: "t-u10",
          name: "U10 Girls",
          organization_id: "org-1",
          organizations: { name: "SLO Futbol LLC", org_name_public: "SLOFC", plan: "club_small" },
          archived_at: null,
        },
      },
    ];
    await renderScreen();

    expect(screen.getByText("SLOFC")).toBeTruthy();
    expect(screen.getByText("SLOFC · U10 Girls")).toBeTruthy();
    expect(screen.getByText("Other teams")).toBeTruthy();
    expect(teamSwitch("SLOFC · U10 Girls")).toBeTruthy();
    expect(teamSwitch("Rec Tuesdays")).toBeTruthy();
  });
});

describe("the account switches' Save button", () => {
  it("saves the account switches only, and a team switch doesn't save them", async () => {
    await renderScreen();

    fireEvent(teamSwitch("U10 Girls"), "valueChange", false);
    await waitFor(() => expect(mockCalls).toHaveLength(1));
    expect(mockCalls.some((c) => c.table === "notification_preferences")).toBe(false);

    mockCalls.length = 0;
    fireEvent.press(screen.getByText("Save preferences"));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCalls.map((c) => c.table)).toEqual(["notification_preferences"]);
  });
});
