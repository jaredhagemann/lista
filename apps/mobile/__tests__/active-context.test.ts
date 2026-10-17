/**
 * The phone's active context (docs/specs/device-local-active-context.md §6):
 * the web's rules, copied, and the phone's own storage of them.
 *
 *   - chooseContext: as on the web (D2-D4, D6; review DC-002)
 *   - storage: one SecureStore key per account, holding the tuple (D1). The
 *     old active_profile_id key seeds a first context, then is retired
 */

const mockStore = new Map<string, string>();
let mockStoreFails = false;
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => {
    if (mockStoreFails) throw new Error("keychain unavailable");
    return mockStore.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

import {
  chooseContext,
  contextKey,
  decodeContext,
  encodeContext,
  onContextSaved,
  readStoredContext,
  saveContext,
  type ContextMembership,
} from "../lib/active-context";

const ME = "00000000-0000-4000-8000-000000000001";
const DAUGHTER = "00000000-0000-4000-8000-000000000002";
const SON = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000008";
const STRANGER = "00000000-0000-4000-8000-000000000009";
const CLUB = "10000000-0000-4000-8000-000000000001";
const REC = "10000000-0000-4000-8000-000000000002";
const COACHING = "10000000-0000-4000-8000-000000000003";
const OLD = "10000000-0000-4000-8000-000000000004";

const member = (profileId: string, teamId: string, archived = false): ContextMembership => ({
  profile_id: profileId,
  team_id: teamId,
  teams: { id: teamId, archived_at: archived ? "2026-09-01T00:00:00Z" : null },
});
const tuple = (profileId: string, teamId: string, accountId = ME) => ({ accountId, profileId, teamId });

function family(overrides: Partial<Parameters<typeof chooseContext>[0]> = {}) {
  return chooseContext({
    userId: ME,
    ownProfile: { id: ME, active_team_id: COACHING },
    managed: [
      { id: DAUGHTER, active_team_id: REC },
      { id: SON, active_team_id: REC },
    ],
    memberships: [member(ME, COACHING), member(DAUGHTER, CLUB), member(DAUGHTER, REC), member(SON, REC)],
    saved: null,
    legacyProfileId: null,
    ...overrides,
  });
}

beforeEach(() => {
  mockStore.clear();
  mockStoreFails = false;
});

describe("chooseContext, as on the web", () => {
  it("keeps a valid saved context, whatever the shared default says", () => {
    const r = family({ saved: tuple(DAUGHTER, CLUB) });
    expect([r.profileId, r.membership?.team_id, r.save]).toEqual([DAUGHTER, CLUB, null]);
  });

  it("D2: no saved context opens at the last-picked team, and saves it", () => {
    const r = family();
    expect([r.profileId, r.membership?.team_id]).toEqual([ME, COACHING]);
    expect(r.save).toEqual(tuple(ME, COACHING));
  });

  it("D2: the old key's person seeds a first context", () => {
    expect(family({ legacyProfileId: DAUGHTER }).profileId).toBe(DAUGHTER);
  });

  it("D2: a parent with no team of their own opens as a child, at the child's last-picked team", () => {
    const r = family({ ownProfile: { id: ME, active_team_id: null }, memberships: [member(DAUGHTER, CLUB), member(DAUGHTER, REC)] });
    expect([r.profileId, r.membership?.team_id]).toEqual([DAUGHTER, REC]);
  });

  it("D3: a saved team the person is off falls back to their last-picked team", () => {
    const r = family({ saved: tuple(DAUGHTER, CLUB), memberships: [member(ME, COACHING), member(DAUGHTER, REC)] });
    expect([r.profileId, r.membership?.team_id]).toEqual([DAUGHTER, REC]);
  });

  it("DC-002: a repair ignores the old key: it seeds a first context only", () => {
    const r = family({ saved: tuple(SON, REC), legacyProfileId: DAUGHTER, memberships: [member(ME, COACHING), member(DAUGHTER, CLUB)] });
    expect([r.profileId, r.membership?.team_id]).toEqual([ME, COACHING]);
  });

  it("D4: an archived team is passed over while another exists", () => {
    const r = family({ saved: tuple(DAUGHTER, CLUB), memberships: [member(ME, COACHING), member(DAUGHTER, CLUB, true), member(DAUGHTER, REC)] });
    expect(r.membership?.team_id).toBe(REC);
  });

  it("D6: another account's tuple, or a teammate's profile, is ignored", () => {
    expect(family({ saved: tuple(DAUGHTER, CLUB, STRANGER) }).profileId).toBe(ME);
    const r = family({ saved: tuple(STRANGER, COACHING), legacyProfileId: STRANGER, memberships: [member(ME, COACHING), member(STRANGER, COACHING)] });
    expect(r.membership?.profile_id).toBe(ME);
  });

  it("no teams: no membership, nothing saved", () => {
    const r = family({ memberships: [] });
    expect([r.membership, r.save]).toEqual([null, null]);
  });
});

describe("storage", () => {
  it("round-trips a tuple, and rejects anything else", () => {
    expect(decodeContext(encodeContext(tuple(DAUGHTER, CLUB)))).toEqual(tuple(DAUGHTER, CLUB));
    for (const value of [null, "", "junk", `v2.${ME}.${DAUGHTER}.${CLUB}`, `v1.${ME}.x.${CLUB}`]) {
      expect(decodeContext(value)).toBeNull();
    }
  });

  it("each account has its own key: one account's context is never another's", async () => {
    await saveContext(tuple(DAUGHTER, CLUB));

    expect((await readStoredContext(ME)).saved).toEqual(tuple(DAUGHTER, CLUB));
    expect((await readStoredContext(OTHER)).saved).toBeNull();
    expect(contextKey(ME)).not.toBe(contextKey(OTHER));
    expect(contextKey(ME)).toMatch(/^[A-Za-z0-9._-]+$/); // SecureStore's key alphabet
  });

  it("a value under one account's key naming another account is ignored", async () => {
    mockStore.set(contextKey(ME), encodeContext(tuple(DAUGHTER, CLUB, OTHER)));

    expect((await readStoredContext(ME)).saved).toBeNull();
  });

  it("reads the old key for seeding, and saving retires it", async () => {
    mockStore.set("active_profile_id", DAUGHTER);
    expect((await readStoredContext(ME)).legacyProfileId).toBe(DAUGHTER);

    await saveContext(tuple(DAUGHTER, REC));
    expect(mockStore.has("active_profile_id")).toBe(false);
  });

  it("a storage failure reads as failed, so nothing is saved over it", async () => {
    mockStoreFails = true;

    expect(await readStoredContext(ME)).toEqual({ saved: null, legacyProfileId: null, failed: true });
  });

  it("tells listeners when a context is saved, for the invitation screen outside the provider", async () => {
    const heard: unknown[] = [];
    const stop = onContextSaved((c) => heard.push(c));

    await saveContext(tuple(DAUGHTER, CLUB));
    stop();
    await saveContext(tuple(DAUGHTER, REC));

    expect(heard).toEqual([tuple(DAUGHTER, CLUB)]);
  });
});
