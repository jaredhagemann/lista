/**
 * Rendering tests for the HomeScreen component.
 *
 * Covers test-plan section §6.1:
 *   §6.1.1 — Empty state shown when no membership
 *   §6.1.2 — "Create a team" button navigates to CreateTeamScreen
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

// Variables referenced in jest.mock() factories must be prefixed with "mock"
const mockDefaultContext = {
  membership: null,
  loading: false,
  membershipLoading: false,
  refresh: jest.fn().mockResolvedValue(undefined),
  activeProfile: null,
  ownProfile: null,
  allMemberships: [],
  managedProfiles: [],
  profilesOnActiveTeam: [],
  switching: false,
  switchTeam: jest.fn(),
  switchProfile: jest.fn(),
};

jest.mock("../contexts/AppContext", () => ({
  useAppContext: () => mockDefaultContext,
}));

import HomeScreen from "../app/(app)/index";

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("HomeScreen — no-team empty state (§6.1)", () => {
  it("§6.1.1 renders 'Welcome to Lista' heading when membership is null", () => {
    render(<HomeScreen />);
    expect(screen.getByText("Welcome to Lista")).toBeTruthy();
  });

  it("§6.1.1 renders 'Create a team' button when membership is null", () => {
    render(<HomeScreen />);
    expect(screen.getByText("Create a team")).toBeTruthy();
  });

  it("§6.1.1 renders 'I have an invite link' link when membership is null", () => {
    render(<HomeScreen />);
    expect(screen.getByText("I have an invite link")).toBeTruthy();
  });

  it("§6.1.2 'Create a team' button navigates to create-team screen", () => {
    render(<HomeScreen />);
    fireEvent.press(screen.getByText("Create a team"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/create-team");
  });
});
