/**
 * Bulk availability across unloaded pages (BUG-014, spec §8).
 *
 * Once the matrix stops loading the whole window, "set my unanswered events to
 * Available" can no longer mean "the ten events in the browser". The scope is
 * the selected window and event type, whatever is on screen, so the selection
 * happens in the database.
 *
 * The rules this pins down are the ones that make a bulk write safe to run
 * against events the caller never saw: it may only ever fill in blanks, it may
 * only act for the caller's own profile or a player they manage, and it is one
 * transaction — a failure leaves nothing half-written.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

const DAY_MS = 24 * 60 * 60 * 1000;

/** A window wide enough to hold every event these tests seed. */
function windowBounds() {
  return {
    p_from: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    p_to: new Date(Date.now() + 200 * DAY_MS).toISOString(),
  };
}

type EventSeed = {
  title: string;
  daysFromNow: number;
  type?: "practice" | "game" | "other";
  cancelled?: boolean | null;
};

async function seedEvents(teamId: string, createdBy: string, seeds: EventSeed[]) {
  const rows = seeds.map((seed) => ({
    id: crypto.randomUUID(),
    team_id: teamId,
    title: seed.title,
    event_type: seed.type ?? "practice",
    start_time: new Date(Date.now() + seed.daysFromNow * DAY_MS).toISOString(),
    end_time: new Date(Date.now() + seed.daysFromNow * DAY_MS + 3600_000).toISOString(),
    is_cancelled: seed.cancelled === undefined ? false : seed.cancelled,
    created_by: createdBy,
  }));
  const { error } = await adminClient.from("events").insert(rows);
  if (error) throw new Error(error.message);
  return Object.fromEntries(rows.map((r, i) => [seeds[i].title, r.id])) as Record<string, string>;
}

async function responsesFor(profileId: string) {
  const { data, error } = await adminClient
    .from("availability")
    .select("event_id, status")
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.event_id as string, row.status as string]));
}

/** A player who can sign in, on their own team. */
async function seedPlayerOnTeam() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  const player = await createTestUser();
  await addTeamMember(teamId, player.user.id, "player");
  return { coach, player, teamId };
}

describe("set_unanswered_availability", () => {
  it("fills in only the unanswered future events in the window", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const events = await seedEvents(teamId, coach.user.id, [
      { title: "unanswered-soon", daysFromNow: 2 },
      { title: "unanswered-later", daysFromNow: 40 },
      { title: "already-unavailable", daysFromNow: 5 },
      { title: "already-maybe", daysFromNow: 6 },
      { title: "in-the-past", daysFromNow: -3 },
      { title: "cancelled", daysFromNow: 7, cancelled: true },
      { title: "beyond-the-window", daysFromNow: 300 },
    ]);
    await adminClient.from("availability").insert([
      { event_id: events["already-unavailable"], profile_id: player.user.id, status: "unavailable" },
      { event_id: events["already-maybe"], profile_id: player.user.id, status: "maybe" },
      { event_id: events["in-the-past"], profile_id: player.user.id, status: "unavailable" },
    ]);

    const { data, error } = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error).toBeNull();
    expect(data).toBe(2);

    const after = await responsesFor(player.user.id);
    expect(after.get(events["unanswered-soon"])).toBe("available");
    expect(after.get(events["unanswered-later"])).toBe("available");
    // An answer already given is never an "unanswered" event, whatever it says.
    expect(after.get(events["already-unavailable"])).toBe("unavailable");
    expect(after.get(events["already-maybe"])).toBe("maybe");
    // Nothing is written for an event that has already happened, is cancelled,
    // or falls outside the window the reader selected.
    expect(after.has(events["cancelled"])).toBe(false);
    expect(after.has(events["beyond-the-window"])).toBe(false);
  });

  it("treats an event with no cancellation flag as not cancelled", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const events = await seedEvents(teamId, coach.user.id, [
      { title: "null-flag", daysFromNow: 3, cancelled: null },
    ]);

    const { data, error } = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await responsesFor(player.user.id)).get(events["null-flag"])).toBe("available");
  });

  it("respects the event-type filter, and covers every type without one", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const events = await seedEvents(teamId, coach.user.id, [
      { title: "practice", daysFromNow: 2, type: "practice" },
      { title: "game", daysFromNow: 3, type: "game" },
      { title: "other", daysFromNow: 4, type: "other" },
    ]);

    const first = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: "game",
      ...windowBounds(),
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(1);

    let after = await responsesFor(player.user.id);
    expect(after.get(events["game"])).toBe("available");
    expect(after.has(events["practice"])).toBe(false);

    const second = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "maybe",
      p_event_type: null,
      ...windowBounds(),
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(2);

    after = await responsesFor(player.user.id);
    // The game already had an answer, so the second call left it alone.
    expect(after.get(events["game"])).toBe("available");
    expect(after.get(events["practice"])).toBe("maybe");
    expect(after.get(events["other"])).toBe("maybe");
  });

  it("skips an event answered between the preview and the confirmation", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const events = await seedEvents(teamId, coach.user.id, [
      { title: "answered-meanwhile", daysFromNow: 2 },
      { title: "still-unanswered", daysFromNow: 3 },
    ]);

    // The reader saw a preview of two, then answered one from another device.
    await adminClient.from("availability").insert({
      event_id: events["answered-meanwhile"],
      profile_id: player.user.id,
      status: "unavailable",
    });

    const { data, error } = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error).toBeNull();
    // The count is what was actually written, not what the preview promised.
    expect(data).toBe(1);
    const after = await responsesFor(player.user.id);
    expect(after.get(events["answered-meanwhile"])).toBe("unavailable");
    expect(after.get(events["still-unanswered"])).toBe("available");
  });

  it("lets a competing insert win rather than overwriting it", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const events = await seedEvents(teamId, coach.user.id, [
      { title: "contested", daysFromNow: 2 },
    ]);

    // Genuinely at the same time, unlike the sequential case above: two
    // transactions racing for the same (event_id, profile_id).
    const [bulk, competing] = await Promise.all([
      player.client.rpc("set_unanswered_availability", {
        p_team_id: teamId,
        p_profile_id: player.user.id,
        p_status: "available",
        p_event_type: null,
        ...windowBounds(),
      }),
      adminClient.from("availability").insert({
        event_id: events["contested"],
        profile_id: player.user.id,
        status: "unavailable",
      }),
    ]);

    expect(bulk.error).toBeNull();
    const after = await responsesFor(player.user.id);
    // Whoever got there first, the unique key leaves exactly one row, and the
    // bulk action never turns someone else's answer into its own.
    expect(after.size).toBe(1);
    if (bulk.data === 1) {
      expect(after.get(events["contested"])).toBe("available");
      expect(competing.error?.code).toBe("23505");
    } else {
      expect(bulk.data).toBe(0);
      expect(after.get(events["contested"])).toBe("unavailable");
      expect(competing.error).toBeNull();
    }
  });

  it("lets a guardian act for the player they manage", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, childId, "player");
    const events = await seedEvents(teamId, coach.user.id, [{ title: "child", daysFromNow: 2 }]);

    const { data, error } = await guardian.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: childId,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await responsesFor(childId)).get(events["child"])).toBe("available");
  });

  it("refuses to answer for a player the caller does not manage, coach or not", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    await seedEvents(teamId, coach.user.id, [{ title: "practice", daysFromNow: 2 }]);

    // Pagination does not introduce a bulk action over other players (spec §8.1),
    // and coaching the team is not permission to answer on someone's behalf.
    const { error } = await coach.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    // The code, not merely that something failed: a missing or renamed
    // function would otherwise satisfy this test.
    expect(error?.code).toBe("42501");
    expect(await responsesFor(player.user.id)).toEqual(new Map());
  });

  it("refuses a team the target does not belong to", async () => {
    const { coach, player } = await seedPlayerOnTeam();
    const other = await createTestUser();
    const { teamId: otherTeamId } = await createTestTeam(other.user.id);
    await seedEvents(otherTeamId, coach.user.id, [{ title: "elsewhere", daysFromNow: 2 }]);

    const { error } = await player.client.rpc("set_unanswered_availability", {
      p_team_id: otherTeamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error?.code).toBe("42501");
    expect(await responsesFor(player.user.id)).toEqual(new Map());
  });

  it("never writes another team's events, even for a team the caller is on", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    const secondCoach = await createTestUser();
    const { teamId: secondTeamId } = await createTestTeam(secondCoach.user.id);
    await addTeamMember(secondTeamId, player.user.id, "player");

    const here = await seedEvents(teamId, coach.user.id, [{ title: "here", daysFromNow: 2 }]);
    const there = await seedEvents(secondTeamId, secondCoach.user.id, [
      { title: "there", daysFromNow: 2 },
    ]);

    const { data, error } = await player.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error).toBeNull();
    expect(data).toBe(1);
    const after = await responsesFor(player.user.id);
    expect(after.has(here["here"])).toBe(true);
    expect(after.has(there["there"])).toBe(false);
  });

  it("rejects a status, event type or window it was not designed for", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    await seedEvents(teamId, coach.user.id, [{ title: "practice", daysFromNow: 2 }]);
    const base = {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    };

    const badStatus = await player.client.rpc("set_unanswered_availability", {
      ...base,
      p_status: "present",
    });
    expect(badStatus.error?.code).toBe("22023");

    const badType = await player.client.rpc("set_unanswered_availability", {
      ...base,
      p_event_type: "scrimmage",
    });
    expect(badType.error?.code).toBe("22023");

    const backwards = await player.client.rpc("set_unanswered_availability", {
      ...base,
      p_from: base.p_to,
      p_to: base.p_from,
    });
    expect(backwards.error?.code).toBe("22023");

    // A window nobody could have selected is a bug in the caller, not a licence
    // to walk the whole events table.
    const enormous = await player.client.rpc("set_unanswered_availability", {
      ...base,
      p_to: new Date(Date.now() + 4000 * DAY_MS).toISOString(),
    });
    expect(enormous.error?.code).toBe("22023");

    expect(await responsesFor(player.user.id)).toEqual(new Map());
  });

  it("is not callable without signing in", async () => {
    const { coach, player, teamId } = await seedPlayerOnTeam();
    await seedEvents(teamId, coach.user.id, [{ title: "practice", daysFromNow: 2 }]);
    const anon = await createTestUser();
    await anon.client.auth.signOut();

    const { error } = await anon.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: player.user.id,
      p_status: "available",
      p_event_type: null,
      ...windowBounds(),
    });

    expect(error?.code).toBe("28000");
    expect(await responsesFor(player.user.id)).toEqual(new Map());
  });
});
