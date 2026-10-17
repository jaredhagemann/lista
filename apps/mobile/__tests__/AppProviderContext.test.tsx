/**
 * The real AppProvider's context (docs/specs/device-local-active-context.md
 * §6; acceptance 1, 2, 4, 5 and 9). The database's active_team_id is shared,
 * as in production; this phone's SecureStore is its own.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

const ME = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000005";
const DAUGHTER = "00000000-0000-4000-8000-000000000002";
const SON = "00000000-0000-4000-8000-000000000003";
const CLUB = "10000000-0000-4000-8000-000000000001";
const REC = "10000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;
const mockDb: Record<string, Row[]> = {};
const mockFailing = new Set<string>();
const mockGates: Partial<Record<string, Promise<void>>> = {};
const mockStore = new Map<string, string>();
let mockStoreFails = false;
let mockSession: { user: { id: string } } | null = { user: { id: ME } };

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => {
    if (mockStoreFails) throw new Error("keychain unavailable");
    return mockStore.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));
jest.mock("../app/_layout", () => ({ useSession: () => mockSession }));
jest.mock("../lib/supabase", () => {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const eqs: string[] = [];
    let update: Row | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.update = (values: Row) => ((update = values), chain);
    chain.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), eqs.push(`${c}=${String(v)}`), chain);
    chain.neq = (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain);
    chain.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), eqs.push(`${c}~${v.join(",")}`), chain);
    const run = async (one: boolean) => {
      const gate = eqs.map((e) => mockGates[`${table}:${e}`]).find(Boolean);
      if (gate) await gate;
      if (mockFailing.has(table)) return { data: null, error: { message: "timeout" } };
      const rows = (mockDb[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (update) {
        rows.forEach((r) => Object.assign(r, update));
        return { data: null, error: null };
      }
      const copies = rows.map((r) => JSON.parse(JSON.stringify(r)));
      return { data: one ? (copies[0] ?? null) : copies, error: null };
    };
    chain.single = () => run(true);
    chain.maybeSingle = () => run(true);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej);
    return chain;
  };
  return { supabase: { from } };
});

import { AppProvider, useAppContext } from "../contexts/AppContext";
import { contextKey, encodeContext, saveContext } from "../lib/active-context";

const team = (id: string) => ({ id, name: id === CLUB ? "Club" : "Rec", season: null, logo_url: null, home_uniform: null, away_uniform: null, archived_at: null, organizations: null });
const profile = (id: string, active_team_id: string | null) => ({ id, first_name: id.slice(-1), last_name: "", email: null, avatar_url: null, active_team_id, birthday: null, gender: null });

function seed() {
  mockDb.profiles = [profile(ME, null), profile(PARTNER, null), profile(DAUGHTER, REC), profile(SON, REC)];
  const p = (id: string) => mockDb.profiles.find((r) => r.id === id)!;
  mockDb.profile_managers = [
    { manager_id: ME, managed_id: DAUGHTER, relationship: "Dad", profiles: p(DAUGHTER) },
    { manager_id: ME, managed_id: SON, relationship: "Dad", profiles: p(SON) },
    { manager_id: PARTNER, managed_id: DAUGHTER, relationship: "Mom", profiles: p(DAUGHTER) },
  ];
  mockDb.team_members = [
    { id: "m-1", team_id: CLUB, profile_id: DAUGHTER, role: "player", teams: team(CLUB), profiles: p(DAUGHTER) },
    { id: "m-2", team_id: REC, profile_id: DAUGHTER, role: "player", teams: team(REC), profiles: p(DAUGHTER) },
    { id: "m-3", team_id: REC, profile_id: SON, role: "player", teams: team(REC), profiles: p(SON) },
  ];
}
const setDefault = (profileId: string, teamId: string) => {
  mockDb.profiles.find((r) => r.id === profileId)!.active_team_id = teamId;
};
const savedOnPhone = (account = ME) => mockStore.get(contextKey(account));
const tuple = (profileId: string, teamId: string, accountId = ME) => encodeContext({ accountId, profileId, teamId });

let actions: ReturnType<typeof useAppContext>;
function Probe() {
  actions = useAppContext();
  const { membership, loading } = actions;
  return <Text testID="ctx">{loading ? "loading" : `${membership?.profileId ?? "none"}/${membership?.teamId ?? "none"}`}</Text>;
}
const shown = () => screen.getByTestId("ctx").props.children as string;
async function mount() {
  const view = render(
    <AppProvider>
      <Probe />
    </AppProvider>
  );
  await act(async () => {});
  return view;
}

beforeEach(() => {
  for (const key of Object.keys(mockDb)) delete mockDb[key];
  for (const key of Object.keys(mockGates)) delete mockGates[key];
  mockFailing.clear();
  mockStore.clear();
  mockStoreFails = false;
  mockSession = { user: { id: ME } };
  seed();
});

describe("a phone with a saved context", () => {
  it("keeps it, whatever another device picked since", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, CLUB));
    await mount();

    expect(shown()).toBe(`${DAUGHTER}/${CLUB}`);
    expect(actions.activeProfile?.id).toBe(DAUGHTER);
    expect(savedOnPhone()).toBe(tuple(DAUGHTER, CLUB));
  });

  it("a refresh after another device's switch still keeps it (acceptance 1)", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, REC));
    await mount();

    setDefault(DAUGHTER, CLUB);
    await act(() => actions.refresh());

    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
  });
});

describe("D2: a phone with no context", () => {
  it("opens at the last-picked team and saves it, once (acceptance 4)", async () => {
    await mount();

    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
    expect(savedOnPhone()).toBe(tuple(DAUGHTER, REC));

    setDefault(DAUGHTER, CLUB);
    await act(() => actions.refresh());
    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
  });

  it("the old key seeds the person, and is retired", async () => {
    mockStore.set("active_profile_id", SON);
    await mount();

    expect(shown()).toBe(`${SON}/${REC}`);
    expect(mockStore.has("active_profile_id")).toBe(false);
  });

  it("a failed read saves nothing", async () => {
    mockFailing.add("team_members");
    await mount();

    expect(savedOnPhone()).toBeUndefined();
  });

  it("a storage failure saves nothing over what may be there", async () => {
    mockStoreFails = true;
    await mount();

    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
    expect(savedOnPhone()).toBeUndefined();
  });
});

describe("switching, on this phone only", () => {
  it("switchTeam saves the tuple here and records the last-picked default", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, REC));
    await mount();

    await act(() => actions.switchTeam(CLUB));

    expect(shown()).toBe(`${DAUGHTER}/${CLUB}`);
    expect(savedOnPhone()).toBe(tuple(DAUGHTER, CLUB));
    expect(mockDb.profiles.find((r) => r.id === DAUGHTER)!.active_team_id).toBe(CLUB);
  });

  it("switchProfile saves the tuple here", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, REC));
    await mount();

    await act(() => actions.switchProfile(SON, REC));

    expect(shown()).toBe(`${SON}/${REC}`);
    expect(savedOnPhone()).toBe(tuple(SON, REC));
  });

  it("another guardian's switch leaves this phone's context alone (acceptance 2)", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, REC));
    await mount();

    setDefault(DAUGHTER, CLUB); // the other parent switches the same child
    await act(() => actions.refresh());

    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
  });
});

describe("accounts and stale loads (acceptance 5, 9)", () => {
  it("a load that finishes after the account changed publishes nothing", async () => {
    mockDb.team_members.push({ id: "m-4", team_id: CLUB, profile_id: PARTNER, role: "manager", teams: team(CLUB), profiles: null });
    let release!: () => void;
    mockGates[`team_members:profile_id~${ME},${DAUGHTER},${SON}`] = new Promise<void>((r) => (release = r));
    const view = await mount();

    mockSession = { user: { id: PARTNER } };
    view.rerender(
      <AppProvider>
        <Probe />
      </AppProvider>
    );
    await act(async () => {});
    expect(shown()).toBe(`${PARTNER}/${CLUB}`);

    await act(async () => release());
    expect(shown()).toBe(`${PARTNER}/${CLUB}`);
    expect(savedOnPhone(ME)).toBeUndefined();
  });

  it("each account keeps its own context on a shared phone", async () => {
    mockStore.set(contextKey(ME), tuple(DAUGHTER, CLUB));
    mockStore.set(contextKey(PARTNER), tuple(DAUGHTER, REC, PARTNER));
    mockSession = { user: { id: PARTNER } };
    await mount();

    expect(shown()).toBe(`${DAUGHTER}/${REC}`);
  });

  it("signing out clears what was shown", async () => {
    const view = await mount();
    expect(shown()).toBe(`${DAUGHTER}/${REC}`);

    mockSession = null;
    view.rerender(
      <AppProvider>
        <Probe />
      </AppProvider>
    );
    await act(async () => {});

    expect(actions.membership).toBeNull();
    expect(actions.allMemberships).toEqual([]);
  });
});

describe("a context saved outside the provider", () => {
  it("the invitation screen's save is picked up", async () => {
    await mount();
    expect(shown()).toBe(`${DAUGHTER}/${REC}`);

    await act(async () => {
      await saveContext({ accountId: ME, profileId: DAUGHTER, teamId: CLUB });
    });
    await act(async () => {});

    expect(shown()).toBe(`${DAUGHTER}/${CLUB}`);
  });
});
