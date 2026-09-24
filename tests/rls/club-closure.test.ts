/**
 * Closing a club (BUG-013, part 3; decision D7).
 *
 * D7: a club is closed by archiving it, never erased. Its roster, events,
 * availability and chat stay readable by the people who were in it, and
 * nothing in it can change. Decisions (2026-09-24):
 *   - only the owner closes a club, confirming with its name
 *   - pending invitations and ownership transfers are revoked; nobody new joins
 *   - the subdomain and custom domain are released
 *   - support can reopen a club (reopen_club); there is no self-serve reopen
 *   - after closure the owner may delete their account, leaving the history
 *
 * Read-only is enforced by a trigger on every club table rather than by each
 * policy. It refuses every write that arrives through the API (CLUB_CLOSED) —
 * the service role's too, since many routes write with it on a user's behalf —
 * and lets through only the closure functions themselves, direct database
 * sessions (support, the auth service), and cascades such as an account deletion.
 * The "Orgs deletable by org owner" policy, which would erase a club outright,
 * is gone.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

const HOUR = 60 * 60 * 1000;

/** An open club with an owner, a director, a coach and a player, an event and a chat message. */
async function setupClub() {
  const owner = await createTestUser();
  const director = await createTestUser();
  const coach = await createTestUser();
  const player = await createTestUser();
  const { orgId, teamId } = await createTestTeam(owner.user.id);
  await addOrgMember(orgId, owner.user.id, "owner");
  await addOrgMember(orgId, director.user.id, "director");
  await adminClient.from("team_members").insert({ team_id: teamId, profile_id: director.user.id, role: "director" });
  await addTeamMember(teamId, coach.user.id, "coach");
  await addTeamMember(teamId, player.user.id, "player");

  const { data: org } = await adminClient.from("organizations").select("name").eq("id", orgId).single();
  await adminClient
    .from("organizations")
    .update({
      subdomain: `club-${orgId.slice(0, 8)}`,
      subdomain_status: "active",
      custom_domain: `club-${orgId.slice(0, 8)}.example.com`,
    })
    .eq("id", orgId);

  const eventId = crypto.randomUUID();
  const start = new Date(Date.now() + 48 * HOUR);
  await adminClient.from("events").insert({
    id: eventId,
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + HOUR).toISOString(),
    created_by: coach.user.id,
  });
  await adminClient.from("availability").insert({ event_id: eventId, profile_id: player.user.id, status: "available" });

  const { data: channel } = await adminClient.from("channels").select("id").eq("team_id", teamId).eq("type", "team").single();
  await adminClient.from("messages").insert({ channel_id: channel!.id, sender_id: coach.user.id, body: "See you Thursday" });

  return { owner, director, coach, player, orgId, teamId, eventId, channelId: channel!.id, orgName: org!.name };
}

function close(actorId: string, orgId: string, confirmName: string) {
  return adminClient.rpc("close_club", { p_actor_id: actorId, p_org_id: orgId, p_confirm_name: confirmName });
}

async function closedClub() {
  const club = await setupClub();
  const { error } = await close(club.owner.user.id, club.orgId, club.orgName);
  if (error) throw new Error(error.message);
  return club;
}

async function org(orgId: string) {
  const { data } = await adminClient.from("organizations").select("*").eq("id", orgId).maybeSingle();
  return data;
}

// ── Closing ───────────────────────────────────────────────────────────────────

describe("close_club", () => {
  it("only the owner can close the club", async () => {
    const { director, orgId, orgName } = await setupClub();

    const { error } = await close(director.user.id, orgId, orgName);

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
    expect((await org(orgId))?.closed_at).toBeNull();
  });

  it("the owner must confirm with the club's name", async () => {
    const { owner, orgId, orgName } = await setupClub();

    const { error: wrong } = await close(owner.user.id, orgId, "Some other club");
    expect(wrong?.message).toMatch(/NAME_MISMATCH/);

    const { error: sloppy } = await close(owner.user.id, orgId, `  ${orgName.toUpperCase()} `);
    expect(sloppy).toBeNull();
  });

  it("records the closure and releases the club's domains", async () => {
    const { owner, orgId, orgName } = await setupClub();

    await close(owner.user.id, orgId, orgName);

    const row = await org(orgId);
    expect(row?.closed_at).not.toBeNull();
    expect(row?.closed_by).toBe(owner.user.id);
    // Released the way every subdomain is: quarantined, then freed by the daily
    // cron after 180 days, so old links cannot be taken over at once.
    expect(row?.subdomain_status).toBe("quarantined");
    expect(row?.subdomain_quarantined_at).not.toBeNull();
    expect(row?.custom_domain).toBeNull();
  });

  it("revokes pending invitations and ownership transfers", async () => {
    const { owner, director, orgId, teamId, orgName } = await setupClub();
    await adminClient.from("invitations").insert({ team_id: teamId, email: "late@test.local", role: "player" });
    await adminClient.rpc("create_director_invitation", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_email: "late.director@test.local",
    });
    const { data: transferId } = await adminClient.rpc("start_ownership_transfer", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_to_profile_id: director.user.id,
    });

    await close(owner.user.id, orgId, orgName);

    const { data: teamInvites } = await adminClient.from("invitations").select("id").eq("team_id", teamId).is("accepted_at", null);
    const { data: clubInvites } = await adminClient.from("invitations").select("id").eq("organization_id", orgId).is("accepted_at", null);
    expect(teamInvites).toEqual([]);
    expect(clubInvites).toEqual([]);
    const { data: transfer } = await adminClient.from("organization_ownership_transfers").select("status").eq("id", transferId).single();
    expect(transfer?.status).toBe("cancelled");
  });

  it("a closed club cannot be closed again, and cannot be deleted outright", async () => {
    const { owner, orgId, orgName } = await closedClub();

    const { error } = await close(owner.user.id, orgId, orgName);
    await owner.client.from("organizations").delete().eq("id", orgId);

    expect(error?.message).toMatch(/CLUB_CLOSED/);
    expect(await org(orgId)).not.toBeNull();
  });

  it("an open club cannot be deleted outright either", async () => {
    const { owner, orgId } = await setupClub();

    await owner.client.from("organizations").delete().eq("id", orgId);

    expect(await org(orgId)).not.toBeNull();
  });

  it("clients cannot call close_club or reopen_club", async () => {
    const { owner, orgId, orgName } = await setupClub();

    const { error: closeError } = await owner.client.rpc("close_club", {
      p_actor_id: owner.user.id,
      p_org_id: orgId,
      p_confirm_name: orgName,
    });
    const { error: reopenError } = await owner.client.rpc("reopen_club", { p_org_id: orgId });

    expect(closeError?.code).toBe("42501");
    expect(reopenError?.code).toBe("42501");
  });
});

// ── Read-only history ─────────────────────────────────────────────────────────

describe("a closed club is readable by its members", () => {
  it("the roster, events, availability and chat stay visible", async () => {
    const { player, teamId, eventId, channelId } = await closedClub();

    const roster = await player.client.from("team_members").select("profile_id").eq("team_id", teamId);
    const events = await player.client.from("events").select("id").eq("team_id", teamId);
    const responses = await player.client.from("availability").select("status").eq("event_id", eventId);
    const messages = await player.client.from("messages").select("body").eq("channel_id", channelId);

    expect(roster.data).toHaveLength(4);
    expect(events.data?.map((e) => e.id)).toEqual([eventId]);
    expect(responses.data).toEqual([{ status: "available" }]);
    expect(messages.data).toEqual([{ body: "See you Thursday" }]);
  });

  it("an outsider still sees nothing", async () => {
    const { teamId } = await closedClub();
    const outsider = await createTestUser();

    const { data } = await outsider.client.from("events").select("id").eq("team_id", teamId);

    expect(data).toEqual([]);
  });
});

describe("nothing in a closed club can change", () => {
  it("a player cannot respond or change a response", async () => {
    const { player, eventId } = await closedClub();

    const { error: update } = await player.client
      .from("availability")
      .update({ status: "unavailable" })
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    const { error: remove } = await player.client
      .from("availability")
      .delete()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);

    expect(update?.message).toMatch(/CLUB_CLOSED/);
    expect(remove?.message).toMatch(/CLUB_CLOSED/);
  });

  it("nobody can post in chat", async () => {
    const { player, director, channelId } = await closedClub();

    for (const person of [player, director]) {
      const { error } = await person.client
        .from("messages")
        .insert({ channel_id: channelId, sender_id: person.user.id, body: "hello?" });
      expect(error?.message).toMatch(/CLUB_CLOSED/);
    }
  });

  it("a coach or director cannot touch the schedule, roster, locations or team", async () => {
    const { coach, director, teamId, eventId } = await closedClub();
    const newcomer = await createTestUser();

    for (const staff of [coach, director]) {
      const attempts = [
        await staff.client.from("events").insert({
          team_id: teamId,
          title: "Extra",
          event_type: "practice",
          start_time: new Date(Date.now() + 72 * HOUR).toISOString(),
          end_time: new Date(Date.now() + 73 * HOUR).toISOString(),
          created_by: staff.user.id,
        }),
        await staff.client.from("events").update({ title: "Moved" }).eq("id", eventId),
        await staff.client.from("events").delete().eq("id", eventId),
        await staff.client.from("team_members").insert({ team_id: teamId, profile_id: newcomer.user.id, role: "player" }),
        await staff.client.from("locations").insert({ team_id: teamId, name: "Field 2" }),
        await staff.client.from("teams").update({ name: "Renamed" }).eq("id", teamId),
        await staff.client.from("invitations").insert({ team_id: teamId, email: "new@test.local", role: "player" }),
      ];
      for (const { error } of attempts) expect(error?.message).toMatch(/CLUB_CLOSED/);
    }
  });

  it("the API's service role is refused too: routes write with it on users' behalf", async () => {
    const { teamId } = await closedClub();

    const { error } = await adminClient.from("invitations").insert({ team_id: teamId, email: "via-route@test.local", role: "player" });

    expect(error?.message).toMatch(/CLUB_CLOSED/);
  });

  it("no new team can be created in it", async () => {
    const { director, orgId } = await closedClub();

    const { error } = await director.client.rpc("create_club_team", { org_id: orgId, team_name: "Late team", season: "" });

    expect(error?.message).toMatch(/CLUB_CLOSED/);
  });
});

// ── Afterwards ────────────────────────────────────────────────────────────────

describe("after closure", () => {
  it("the owner can delete their account; the history stays for the others", async () => {
    const { owner, player, orgId, eventId } = await closedClub();

    const { error } = await adminClient.auth.admin.deleteUser(owner.user.id);

    expect(error).toBeNull();
    expect(await org(orgId)).not.toBeNull();
    const { data } = await player.client.from("events").select("id").eq("id", eventId);
    expect(data).toHaveLength(1);
  });

  it("a member can delete their account too", async () => {
    const { player } = await closedClub();

    const { error } = await adminClient.auth.admin.deleteUser(player.user.id);

    expect(error).toBeNull();
  });

  it("support can reopen it, and it is writable again", async () => {
    const { player, orgId, eventId } = await closedClub();

    const { error } = await adminClient.rpc("reopen_club", { p_org_id: orgId });
    expect(error).toBeNull();
    expect((await org(orgId))?.closed_at).toBeNull();

    const { error: write } = await player.client
      .from("availability")
      .update({ status: "maybe" })
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(write).toBeNull();
  });
});

describe("club_member_emails", () => {
  it("lists everyone to tell: members with a login, and guardians of those without", async () => {
    const { owner, coach, player, orgId, teamId } = await setupClub();
    const guardian = await createTestUser();
    const child = await createManagedProfile(guardian.user.id);
    await addTeamMember(teamId, child, "player");

    const { data, error } = await adminClient.rpc("club_member_emails", { p_org_id: orgId });

    expect(error).toBeNull();
    const emails = (data as { email: string }[]).map((r) => r.email);
    expect(emails).toEqual(expect.arrayContaining([owner.user.email, coach.user.email, player.user.email, guardian.user.email]));
    expect(emails.some((e) => e.endsWith("@lista.internal"))).toBe(false);
    expect(new Set(emails).size).toBe(emails.length);
  });
});

