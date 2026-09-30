/**
 * The event screen's availability, trimmed (spec: docs/specs/mobile-next-build.md
 * §1, part 3).
 *
 * - The roster is the event's team's, not the active team's: an event opened
 *   from another team's notification lists that team.
 * - Players are grouped by answer and counted. Everyone else is listed under
 *   "Coaches & staff" with their role.
 * - Answering in "Your availability" moves your own row at once. Tapping the
 *   answer again clears it. A save that fails is undone, and says so.
 */

import React from "react";
import { Alert } from "react-native";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react-native";

const mockTables: Record<string, unknown> = {};
const mockCalls: Array<{ table: string; op: string; args: unknown[] }> = [];
const mockWriteError: { current: { message: string } | null } = { current: null };

jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: mockTables[table] ?? null, error: null });
    const write = () => Promise.resolve({ data: null, error: mockWriteError.current });
    let op = "select";
    const chain: Record<string, unknown> = {};
    const record = (name: string) => (...args: unknown[]) => {
      mockCalls.push({ table, op: name, args });
      return chain;
    };
    for (const m of ["eq", "gte", "order", "limit", "in", "select"]) chain[m] = record(m);
    chain.upsert = (...args: unknown[]) => {
      mockCalls.push({ table, op: "upsert", args });
      return write();
    };
    chain.delete = () => {
      op = "delete";
      mockCalls.push({ table, op: "delete", args: [] });
      return chain;
    };
    chain.single = () => result().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] : r.data }));
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      (op === "delete" ? write() : result()).then(res, rej);
    return chain;
  };
  return { supabase: { from } };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useLocalSearchParams: () => ({ eventId: "e-1" }),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

// The viewer is on another team right now: the roster must still be the event's.
const mockCtx = {
  membership: {
    profileId: "p-ava",
    teamId: "t-active",
    teamName: "Other Team",
    displayName: "Other Team",
    season: null,
    logoUrl: null,
    role: "player",
    homeUniform: null,
    awayUniform: null,
  },
  loading: false,
  refresh: jest.fn(),
};
jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import EventDetailScreen from "../app/(app)/schedule/[eventId]";

const person = (first: string, last: string) => ({ first_name: first, last_name: last });

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockWriteError.current = null;
  mockTables.events = [
    {
      id: "e-1",
      team_id: "t-event",
      title: "Practice",
      event_type: "practice",
      start_time: "2030-10-05T17:00:00.000Z",
      end_time: "2030-10-05T18:30:00.000Z",
      is_cancelled: false,
      notes: null,
      arrival_time: null,
      timezone: null,
      teams: { timezone: "America/Los_Angeles", name: "U10 Girls" },
      locations: null,
    },
  ];
  mockTables.team_members = [
    { profile_id: "p-ava", role: "player", profiles: person("Ava", "Chen") },
    { profile_id: "p-bea", role: "player", profiles: person("Bea", "Diaz") },
    { profile_id: "c-kim", role: "coach", profiles: person("Kim", "Lee") },
  ];
  mockTables.availability = [
    { profile_id: "p-bea", status: "maybe" },
    { profile_id: "c-kim", status: "available" },
  ];
});

const group = (name: RegExp) => screen.getByLabelText(name);
const picker = (answer: string) => within(screen.getByLabelText("Your availability")).getByLabelText(answer);

describe("the event screen's responses", () => {
  it("lists the event's team, not the active one", async () => {
    render(<EventDetailScreen />);
    await screen.findByText("Bea Diaz");

    const rosterFilter = mockCalls.find((c) => c.table === "team_members" && c.op === "eq");
    expect(rosterFilter?.args).toEqual(["team_id", "t-event"]);
  });

  it("groups players by answer and lists coaches and staff apart, with their role", async () => {
    render(<EventDetailScreen />);
    await screen.findByText("Bea Diaz");

    expect(within(group(/^Maybe \(1\)/)).getByText("Bea Diaz")).toBeTruthy();
    expect(within(group(/^No response \(1\)/)).getByText("Ava Chen")).toBeTruthy();
    const staff = group(/^Coaches & staff \(1\)/);
    expect(within(staff).getByText("Kim Lee")).toBeTruthy();
    expect(within(staff).getByText("Coach")).toBeTruthy();
    // Only players count: the coach's "available" isn't in the summary.
    expect(screen.getByText("1 maybe")).toBeTruthy();
  });

  it("moves your own row when you answer, and back when you tap again", async () => {
    render(<EventDetailScreen />);
    await screen.findByText("Bea Diaz");

    fireEvent.press(picker("Available"));
    await waitFor(() => expect(within(group(/^Available \(1\)/)).getByText("Ava Chen")).toBeTruthy());
    expect(screen.getByText("1 available · 1 maybe")).toBeTruthy();
    expect(mockCalls.find((c) => c.op === "upsert")?.args[0]).toEqual({
      event_id: "e-1",
      profile_id: "p-ava",
      status: "available",
    });

    fireEvent.press(picker("Available"));
    await waitFor(() => expect(within(group(/^No response \(1\)/)).getByText("Ava Chen")).toBeTruthy());
    expect(mockCalls.some((c) => c.op === "delete")).toBe(true);
  });

  it("names the third answer Unavailable, as on the web", async () => {
    render(<EventDetailScreen />);
    await screen.findByText("Bea Diaz");

    expect(picker("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Can't go")).toBeNull();
  });

  it("undoes a save that fails, and says so", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockWriteError.current = { message: "permission denied" };
    render(<EventDetailScreen />);
    await screen.findByText("Bea Diaz");

    fireEvent.press(picker("Available"));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toMatch(/couldn't save/i);
    expect(within(group(/^No response \(1\)/)).getByText("Ava Chen")).toBeTruthy();
  });
});
