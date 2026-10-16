/**
 * The device's active context (docs/specs/device-local-active-context.md):
 * which person it views as and which team, kept per device in one tuple with
 * the account (D1). The shared profiles.active_team_id is only a "last picked"
 * default for a device without a valid context of its own (D2, D3).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { chooseContext, type ContextMembership } from "@/lib/active-context";
import { contextCookieOptions, decodeContext, encodeContext } from "@/lib/active-context-cookie";

const ME = "00000000-0000-4000-8000-000000000001";
const DAUGHTER = "00000000-0000-4000-8000-000000000002";
const SON = "00000000-0000-4000-8000-000000000003";
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

/** A parent who coaches; a daughter on a club team and a rec team; a son on the rec team. */
function family(overrides: Partial<Parameters<typeof chooseContext>[0]> = {}) {
  return chooseContext({
    userId: ME,
    ownProfile: { id: ME, active_team_id: COACHING },
    managed: [
      { id: DAUGHTER, active_team_id: REC },
      { id: SON, active_team_id: REC },
    ],
    memberships: [
      member(ME, COACHING),
      member(DAUGHTER, CLUB),
      member(DAUGHTER, REC),
      member(SON, REC),
    ],
    saved: null,
    legacyProfileId: null,
    ...overrides,
  });
}

const tuple = (profileId: string, teamId: string, accountId = ME) => ({ accountId, profileId, teamId });

describe("a device with a valid saved context", () => {
  it("keeps it, whatever the shared default says: other devices can't move it", () => {
    const result = family({ saved: tuple(DAUGHTER, CLUB) });

    expect(result.profileId).toBe(DAUGHTER);
    expect(result.membership?.team_id).toBe(CLUB);
    expect(result.save).toBeNull();
  });
});

describe("D2: a device with no saved context", () => {
  it("opens to the last team picked, for its own profile, and saves it", () => {
    const result = family();

    expect([result.profileId, result.membership?.team_id]).toEqual([ME, COACHING]);
    expect(result.save).toEqual(tuple(ME, COACHING));
  });

  it("keeps the person the old cookie named, at that person's last-picked team", () => {
    const result = family({ legacyProfileId: DAUGHTER });

    expect([result.profileId, result.membership?.team_id]).toEqual([DAUGHTER, REC]);
    expect(result.save).toEqual(tuple(DAUGHTER, REC));
  });

  it("a default that's no longer one of the person's teams falls back to their first team", () => {
    const result = family({ ownProfile: { id: ME, active_team_id: OLD } });

    expect([result.profileId, result.membership?.team_id]).toEqual([ME, COACHING]);
  });

  it("a parent with no team of their own opens as a child, the profile following the team", () => {
    const result = family({
      ownProfile: { id: ME, active_team_id: null },
      memberships: [member(DAUGHTER, CLUB), member(SON, REC)],
    });

    expect([result.profileId, result.membership?.team_id]).toEqual([DAUGHTER, CLUB]);
    expect(result.save).toEqual(tuple(DAUGHTER, CLUB));
  });

  it("an account with no teams has no membership, and saves nothing", () => {
    const result = family({ memberships: [] });

    expect(result.profileId).toBe(ME);
    expect(result.membership).toBeNull();
    expect(result.save).toBeNull();
  });
});

describe("D3: a saved team the account no longer belongs to", () => {
  it("removed from the team: the same person, at their last-picked team, saved", () => {
    const result = family({
      saved: tuple(DAUGHTER, CLUB),
      memberships: [member(ME, COACHING), member(DAUGHTER, REC), member(SON, REC)],
    });

    expect([result.profileId, result.membership?.team_id]).toEqual([DAUGHTER, REC]);
    expect(result.save).toEqual(tuple(DAUGHTER, REC));
  });

  it("a guardian link removed: back to the account's own profile", () => {
    const result = family({
      saved: tuple(SON, REC),
      managed: [{ id: DAUGHTER, active_team_id: REC }],
      memberships: [member(ME, COACHING), member(DAUGHTER, CLUB), member(DAUGHTER, REC)],
    });

    expect([result.profileId, result.membership?.team_id]).toEqual([ME, COACHING]);
    expect(result.save).toEqual(tuple(ME, COACHING));
  });
});

describe("D4: archived teams", () => {
  it("a saved archived team moves to one that isn't", () => {
    const result = family({
      saved: tuple(DAUGHTER, CLUB),
      memberships: [member(ME, COACHING), member(DAUGHTER, CLUB, true), member(DAUGHTER, REC), member(SON, REC)],
    });

    expect([result.profileId, result.membership?.team_id]).toEqual([DAUGHTER, REC]);
  });

  it("with only archived teams, it stays on one rather than none", () => {
    const result = family({
      saved: null,
      ownProfile: { id: ME, active_team_id: OLD },
      managed: [],
      memberships: [member(ME, OLD, true)],
    });

    expect(result.membership?.team_id).toBe(OLD);
  });

  it("a membership whose team can't be seen isn't a context", () => {
    const result = family({
      memberships: [{ profile_id: ME, team_id: OLD, teams: null }, member(ME, COACHING)],
      ownProfile: { id: ME, active_team_id: OLD },
    });

    expect(result.membership?.team_id).toBe(COACHING);
  });
});

describe("D6: a saved context can't act as someone else", () => {
  it("another account's tuple is ignored", () => {
    const result = family({ saved: tuple(DAUGHTER, CLUB, STRANGER) });

    expect([result.profileId, result.membership?.team_id]).toEqual([ME, COACHING]);
    expect(result.save).toEqual(tuple(ME, COACHING));
  });

  it("a teammate's profile, saved or in the old cookie, is ignored", () => {
    const teammate = member(STRANGER, COACHING);
    const result = family({
      saved: tuple(STRANGER, COACHING),
      legacyProfileId: STRANGER,
      memberships: [member(ME, COACHING), teammate],
    });

    expect(result.profileId).toBe(ME);
    expect(result.membership?.profile_id).toBe(ME);
  });
});

describe("the context cookie", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a tuple", () => {
    expect(decodeContext(encodeContext(tuple(DAUGHTER, CLUB)))).toEqual(tuple(DAUGHTER, CLUB));
  });

  it("anything else reads as no context", () => {
    for (const value of [undefined, "", "garbage", `v2.${ME}.${DAUGHTER}.${CLUB}`, `v1.${ME}.${DAUGHTER}`, `v1.${ME}.not-a-uuid.${CLUB}`]) {
      expect(decodeContext(value)).toBeNull();
    }
  });

  it("is HTTP-only, and shared across lista.team subdomains in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUBDOMAIN_ROUTING_ENABLED", "");

    expect(contextCookieOptions()).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: ".lista.team" });
  });

  it("is host-only outside production, or with subdomain routing off", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(contextCookieOptions().domain).toBeUndefined();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUBDOMAIN_ROUTING_ENABLED", "false");
    expect(contextCookieOptions().domain).toBeUndefined();
  });
});
