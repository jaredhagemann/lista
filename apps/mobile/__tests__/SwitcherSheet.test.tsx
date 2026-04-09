/**
 * Rendering and interaction tests for the SwitcherSheet component.
 *
 * Covers test-plan sections:
 *   §7.2 — "Create a new team" row visible with existing membership
 *   §7.3 — Tapping row calls onClose and onCreateTeam
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

// Modal is patched in jest.setup.js to render children when visible=true.

// Context with an existing team membership (for §7.2)
// Must be prefixed with "mock" so jest.mock() factory can reference it.
const mockSwitchTeam = jest.fn();
const mockSwitchProfile = jest.fn();

const mockCtxWithTeam = {
  membership: { teamId: "team-1", teamName: "U12 Boys", profileId: "profile-1", role: "coach", season: null },
  activeProfile: { id: "profile-1" },
  ownProfile: { id: "profile-1" },
  allMemberships: [
    {
      id: "member-1",
      team_id: "team-1",
      profile_id: "profile-1",
      role: "coach",
      teams: { id: "team-1", name: "U12 Boys", season: null, logo_url: null, home_uniform: null, away_uniform: null },
      profiles: { id: "profile-1", first_name: "Coach", last_name: "Jones", email: null, avatar_url: null, active_team_id: "team-1", birthday: null, gender: null },
    },
  ],
  managedProfiles: [],
  profilesOnActiveTeam: [
    {
      profile_id: "profile-1",
      team_id: "team-1",
      role: "coach",
      profiles: { first_name: "Coach", last_name: "Jones" },
    },
  ],
  switching: false,
  switchTeam: mockSwitchTeam,
  switchProfile: mockSwitchProfile,
  refresh: jest.fn(),
  loading: false,
  membershipLoading: false,
};

jest.mock("../contexts/AppContext", () => ({
  useAppContext: () => mockCtxWithTeam,
}));

import { SwitcherSheet } from "../components/SwitcherSheet";

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SwitcherSheet — Create a new team row (§7.2 / §7.3)", () => {
  it("§7.2 renders 'Create a new team' row when sheet is visible", () => {
    render(
      <SwitcherSheet
        visible={true}
        onClose={jest.fn()}
        onCreateTeam={jest.fn()}
      />
    );
    expect(screen.getByText("Create a new team")).toBeTruthy();
  });

  it("§7.2 'Create a new team' row is present alongside existing team rows", () => {
    render(
      <SwitcherSheet
        visible={true}
        onClose={jest.fn()}
        onCreateTeam={jest.fn()}
      />
    );
    // Existing team row
    expect(screen.getByText("U12 Boys")).toBeTruthy();
    // Create row also present
    expect(screen.getByText("Create a new team")).toBeTruthy();
  });

  it("§7.3 tapping 'Create a new team' calls onClose", () => {
    const onClose = jest.fn();
    const onCreateTeam = jest.fn();
    render(
      <SwitcherSheet visible={true} onClose={onClose} onCreateTeam={onCreateTeam} />
    );
    fireEvent.press(screen.getByText("Create a new team"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("§7.3 tapping 'Create a new team' calls onCreateTeam", () => {
    const onClose = jest.fn();
    const onCreateTeam = jest.fn();
    render(
      <SwitcherSheet visible={true} onClose={onClose} onCreateTeam={onCreateTeam} />
    );
    fireEvent.press(screen.getByText("Create a new team"));
    expect(onCreateTeam).toHaveBeenCalledTimes(1);
  });

  it("does not render sheet content when visible=false", () => {
    render(
      <SwitcherSheet
        visible={false}
        onClose={jest.fn()}
        onCreateTeam={jest.fn()}
      />
    );
    expect(screen.queryByText("Create a new team")).toBeNull();
  });
});
