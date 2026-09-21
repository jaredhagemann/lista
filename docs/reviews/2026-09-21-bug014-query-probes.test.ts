// Review probes assert observed behavior, not the desired fixes. Local DB only.
import { afterAll, expect, it } from "vitest";
import { fetchAllRows } from "../../apps/web/src/lib/supabase/fetch-all-rows";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "../../tests/rls/helpers";
afterAll(cleanupTestData);
it("offset pagination silently loses a retained event when a previous row is deleted", async () => {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  const events = Array.from({ length: 501 }, (_, i) => ({ id: crypto.randomUUID(), team_id: teamId,
    title: `Review ${i}`, event_type: "practice", created_by: coach.user.id,
    start_time: new Date(Date.now() + i * 86400000).toISOString(),
    end_time: new Date(Date.now() + i * 86400000 + 3600000).toISOString() }));
  const { error } = await adminClient.from("events").insert(events);
  if (error) throw error;
  let calls = 0;
  const all = await fetchAllRows(async (from, to) => {
    if (++calls === 2) {
      const { error: deletionError } = await adminClient.from("events").delete().eq("id", events[0].id);
      if (deletionError) throw deletionError;
    }
    return adminClient.from("events").select("id").eq("team_id", teamId).order("start_time").range(from, to);
  });
  expect(all).toHaveLength(500);
  expect(all.some(e => e.id === events[500].id)).toBe(false);
  const { data: retained } = await adminClient.from("events").select("id").eq("id", events[500].id).single();
  expect(retained?.id).toBe(events[500].id);
});
it("records the local gateway result for growing IN lists", async () => {
  for (const count of [50, 200, 300, 500, 1000]) {
    const ids = Array.from({ length: count }, () => crypto.randomUUID());
    const result = await adminClient.from("availability").select("event_id,profile_id,status").in("event_id", ids).order("event_id").range(0, 499);
    console.log(JSON.stringify({ count, status: result.status, error: result.error?.message?.slice(0, 120) }));
  }
});
