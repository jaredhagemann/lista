// Review evidence: these assertions demonstrate current defects, not desired regressions.
import { afterAll, expect, it } from "vitest";
import { fetchEventPage, fetchEventRange } from "../../apps/web/src/lib/events/queries";
import { fetchResponsesForEvents, fetchTeamRoster } from "../../apps/web/src/lib/availability/queries";
import { adminClient, createTestUser, createTestTeam, createManagedProfile, addTeamMember, cleanupTestData } from "../../tests/rls/helpers";
afterAll(cleanupTestData);

async function setup(count = 2) {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  const ids = Array.from({ length: count }, () => crypto.randomUUID()).sort();
  const rows = ids.map((id, i) => ({ id, team_id: teamId, title: `Review ${i}`, event_type: "practice",
    start_time: `2027-06-0${i + 1}T12:00:00Z`, end_time: `2027-06-0${i + 1}T13:00:00Z`, created_by: coach.user.id }));
  const { error } = await adminClient.from("events").insert(rows);
  if (error) throw error;
  return { coach, teamId, ids };
}

it("null response keys consume lookahead and silently hide a later valid response", async () => {
  const { coach, teamId, ids } = await setup();
  const child = await createManagedProfile(coach.user.id);
  await addTeamMember(teamId, child, "player");
  const { error } = await coach.client.from("availability").insert([
    { event_id: ids[0], profile_id: coach.user.id, status: "available" },
    { event_id: ids[0], profile_id: child, status: "available" },
    { event_id: ids[0], profile_id: null, status: "available" },
    { event_id: ids[1], profile_id: coach.user.id, status: "unavailable" },
  ]);
  if (error) throw error;
  const result = await fetchResponsesForEvents(coach.client, ids, { batchSize: 2 });
  expect(result).toHaveLength(2);
  expect(result.some(r => r.event_id === ids[1])).toBe(false);
  const { count } = await coach.client.from("availability").select("id", { count: "exact", head: true })
    .in("event_id", ids).not("profile_id", "is", null);
  expect(count).toBe(3);
});

it("null roster keys cause the complete roster read to reject", async () => {
  const { coach, teamId } = await setup(1);
  // Legacy/null membership fixtures require administrative setup; current RLS
  // prevents the coach creating them, but the nullable schema still permits them.
  const { error } = await adminClient.from("team_members").insert([
    { team_id: teamId, profile_id: null, role: "player" },
    { team_id: teamId, profile_id: null, role: "player" },
  ]);
  if (error) throw error;
  await expect(fetchTeamRoster(coach.client, teamId, { batchSize: 2 })).rejects.toThrow("without a usable cursor");
});

it("an oversized roster batch silently truncates at the configured API cap", async () => {
  const { coach, teamId } = await setup(1);
  for (let offset = 0; offset < 1000; offset += 25) {
    const ids = await Promise.all(Array.from({ length: 25 }, () => createManagedProfile(coach.user.id)));
    const { error } = await adminClient.from("team_members").insert(ids.map(profile_id => ({ team_id: teamId, profile_id, role: "player" })));
    if (error) throw error;
  }
  const result = await fetchTeamRoster(coach.client, teamId, { batchSize: 1000 });
  expect(result).toHaveLength(1000);
  const { count, error } = await coach.client.from("team_members").select("id", { count: "exact", head: true }).eq("team_id", teamId);
  if (error) throw error;
  expect(count).toBe(1001);
});

it("complete event ranges return a duplicate when an event moves across the cursor", async () => {
  const { coach, teamId, ids } = await setup(4);
  let calls = 0;
  const wrapped = {
    from: (table: string) => {
      const builder = coach.client.from(table);
      const select = builder.select.bind(builder);
      builder.select = (...args: Parameters<typeof select>) => {
        const query = select(...args);
        const then = query.then.bind(query);
        query.then = ((resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          then(async result => {
            if (++calls === 1) {
              const { error } = await coach.client.from("events").update({ start_time: "2027-06-05T12:00:00Z", end_time: "2027-06-05T13:00:00Z" }).eq("id", ids[0]);
              if (error) throw error;
            }
            return result;
          }).then(resolve, reject)) as typeof query.then;
        return query;
      };
      return builder;
    },
  } as typeof coach.client;
  const result = await fetchEventRange(wrapped, {
    query: { teamId, includeCancelled: true, fromInclusive: "2027-06-01T00:00:00Z", toExclusive: "2027-07-01T00:00:00Z" },
    projection: "calendar", batchSize: 2,
  });
  expect(result).toHaveLength(5);
  expect(new Set(result.map(r => r.id)).size).toBe(4);
});

it("calendar projection is typed as a full event but does not return those fields", async () => {
  const { coach, teamId } = await setup(1);
  const result = await fetchEventPage(coach.client, { query: { teamId, includeCancelled: true }, projection: "calendar", pageSize: 1, cursor: null });
  const claimedNotes: string | null = result.items[0].notes;
  expect(claimedNotes).toBeUndefined();
});
