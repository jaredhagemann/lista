/**
 * Rendering and interaction tests for the no-team empty states on the
 * Schedule, Team, and Chat tabs.
 *
 * Covers test-plan sections:
 *   §6.2 — Schedule tab empty state (no membership)
 *   §6.3 — Team tab empty state (no membership)
 *   §6.4 — Chat tab empty state (no membership)
 *
 * Each section verifies:
 *   §x.1 — "No team yet" heading renders when membership is null
 *   §x.2 — "Create a team" button navigates to /(app)/create-team
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: mockRouterPush }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    // Behave like a screen that immediately focuses so local loading state resolves
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
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

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "mock-uuid"),
}));

// Mock app/_layout via the resolved path that chat/index.tsx imports ("../../_layout")
// useSession() returns the session object directly (not { session: ... })
jest.mock("../app/_layout", () => ({
  useSession: () => ({ user: { id: "" } }),
  storePendingInvite: jest.fn(),
}));

// Variables referenced in jest.mock() factories must be prefixed with "mock"
const mockNoTeamContext = {
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
  useAppContext: () => mockNoTeamContext,
}));

import ScheduleScreen from "../app/(app)/schedule/index";
import TeamScreen from "../app/(app)/team/index";
import ChatScreen from "../app/(app)/chat/index";

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── §6.2 Schedule tab ─────────────────────────────────────────────────────────

describe("ScheduleScreen — no-team empty state (§6.2)", () => {
  it("§6.2.1 renders 'No team yet' when membership is null", () => {
    render(<ScheduleScreen />);
    expect(screen.getByText("No team yet")).toBeTruthy();
  });

  it("§6.2.1 renders 'Create a team' button when membership is null", () => {
    render(<ScheduleScreen />);
    expect(screen.getByText("Create a team")).toBeTruthy();
  });

  it("§6.2.2 'Create a team' button navigates to /(app)/create-team", () => {
    render(<ScheduleScreen />);
    fireEvent.press(screen.getByText("Create a team"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/create-team");
  });
});

// ── §6.3 Team tab ─────────────────────────────────────────────────────────────

describe("TeamScreen — no-team empty state (§6.3)", () => {
  it("§6.3.1 renders 'No team yet' when membership is null", () => {
    render(<TeamScreen />);
    expect(screen.getByText("No team yet")).toBeTruthy();
  });

  it("§6.3.1 renders 'Create a team' button when membership is null", () => {
    render(<TeamScreen />);
    expect(screen.getByText("Create a team")).toBeTruthy();
  });

  it("§6.3.2 'Create a team' button navigates to /(app)/create-team", () => {
    render(<TeamScreen />);
    fireEvent.press(screen.getByText("Create a team"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/create-team");
  });
});

// ── §6.4 Chat tab ─────────────────────────────────────────────────────────────

describe("ChatScreen — no-team empty state (§6.4)", () => {
  it("§6.4.1 renders 'No team yet' when membership is null", () => {
    render(<ChatScreen />);
    expect(screen.getByText("No team yet")).toBeTruthy();
  });

  it("§6.4.1 renders 'Create a team' button when membership is null", () => {
    render(<ChatScreen />);
    expect(screen.getByText("Create a team")).toBeTruthy();
  });

  it("§6.4.2 'Create a team' button navigates to /(app)/create-team", () => {
    render(<ChatScreen />);
    fireEvent.press(screen.getByText("Create a team"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/create-team");
  });
});
