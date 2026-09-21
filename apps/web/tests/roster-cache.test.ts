/**
 * The availability roster cache (BUG-014, spec §7.2).
 *
 * The roster belongs to the team, not to the event page on screen, so paging
 * through events must not read it again. The rules that make caching it safe are
 * the same ones the month cache follows: only a successful read is remembered,
 * one request serves every caller waiting on it, and a read that started before
 * the cache was thrown away cannot refill it.
 */

import { describe, it, expect, vi } from "vitest";
import { createRosterCache } from "@/lib/availability/roster-cache";

const TEAM = "team-1";
const OTHER = "team-2";

function member(name: string) {
  return { profileId: name, name, role: "player" as const };
}

describe("createRosterCache", () => {
  it("reads once and serves the rest from memory", async () => {
    const read = vi.fn().mockResolvedValue([member("a")]);
    const cache = createRosterCache({ read });

    expect(await cache.load(TEAM)).toEqual([member("a")]);
    expect(await cache.load(TEAM)).toEqual([member("a")]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps each team separate", async () => {
    const read = vi.fn(async (teamId: string) => [member(teamId)]);
    const cache = createRosterCache({ read });

    expect(await cache.load(TEAM)).toEqual([member(TEAM)]);
    expect(await cache.load(OTHER)).toEqual([member(OTHER)]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("serves one read to callers who ask at the same time", async () => {
    let settle!: (rows: ReturnType<typeof member>[]) => void;
    const read = vi.fn(
      () => new Promise<ReturnType<typeof member>[]>((resolve) => (settle = resolve))
    );
    const cache = createRosterCache({ read });

    const both = Promise.all([cache.load(TEAM), cache.load(TEAM)]);
    settle([member("a")]);

    expect(await both).toEqual([[member("a")], [member("a")]]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure as an empty team", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue([member("a")]);
    const cache = createRosterCache({ read });

    await expect(cache.load(TEAM)).rejects.toThrow("network");
    // A cached empty roster would render as a team with nobody on it.
    expect(cache.peek(TEAM)).toBeUndefined();
    expect(await cache.load(TEAM)).toEqual([member("a")]);
  });

  it("reads again once the roster is old enough to have changed", async () => {
    const read = vi.fn().mockResolvedValue([member("a")]);
    let clock = 0;
    const cache = createRosterCache({ read, freshFor: 60_000, now: () => clock });

    await cache.load(TEAM);
    clock = 59_000;
    await cache.load(TEAM);
    expect(read).toHaveBeenCalledTimes(1);

    clock = 61_000;
    await cache.load(TEAM);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again when asked to, however fresh the copy is", async () => {
    const read = vi.fn().mockResolvedValue([member("a")]);
    const cache = createRosterCache({ read, now: () => 0 });

    await cache.load(TEAM);
    cache.invalidate();
    await cache.load(TEAM);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("cannot be refilled by a read that started before it was invalidated", async () => {
    let settle!: (rows: ReturnType<typeof member>[]) => void;
    const read = vi.fn(
      () => new Promise<ReturnType<typeof member>[]>((resolve) => (settle = resolve))
    );
    const cache = createRosterCache({ read });

    const inFlight = cache.load(TEAM);
    // The reader switched teams, or someone changed the roster, while it ran.
    cache.invalidate();
    settle([member("stale")]);
    await inFlight;

    expect(cache.peek(TEAM)).toBeUndefined();
  });
});
