// PR #159 review at ff195e6b4e22a307f833f52770456d578cb6c74a.
// Requires the local Supabase stack with both PR migrations applied, and Docker.
// Creates and cleans up temporary users and teams. Migration replay rolls back.
// Copy to tests/rls/pr159-review-probes.test.ts, then run from the repo root:
// node node_modules/vitest/vitest.mjs run --config vitest.config.rls.mts tests/rls/pr159-review-probes.test.ts
// Remove that temporary copy afterward. Three desired-behavior assertions fail
// at the reviewed revision; the migration replay and privilege check pass.
import { afterAll, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { isClubAdminOfTeam } from "@/lib/club/club-admin";
import { adminClient, createTestUser, createTestTeam, addTeamMember, addOrgMember, cleanupTestData, trackIds, setOrgPlan } from "../../tests/rls/helpers";

const api = vi.hoisted(() => ({ user: null as unknown, client: null as unknown }));
vi.mock("@/lib/api-auth", () => ({ resolveRequestUser: async () => api.user, adminClient: () => api.client }));
vi.mock("@/lib/active-context-save", () => ({ saveContextCookie: vi.fn() }));
import { POST as createClubTeam } from "../../apps/web/src/app/api/club/teams/route";

const execFileAsync = promisify(execFile);
afterAll(cleanupTestData);

function sql(statement: string) {
  return execFileSync("docker", ["exec", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], { encoding: "utf8" }).trim();
}

async function setup(role: "coach" | "player" = "player") {
  const owner = await createTestUser();
  const director = await createTestUser();
  const { orgId, teamId } = await createTestTeam(owner.user.id);
  await addOrgMember(orgId, owner.user.id, "owner");
  await addOrgMember(orgId, director.user.id, "director");
  await setOrgPlan(orgId);
  await addTeamMember(teamId, director.user.id, role);
  const { data, error } = await adminClient.from("team_members").select("id").eq("team_id", teamId).eq("profile_id", director.user.id).single();
  if (error) throw error;
  return { owner, director, orgId, teamId, memberId: data!.id };
}

it("replays both migrations transactionally over populated local data and verifies privileges", () => {
  const first = readFileSync("supabase/migrations/20261105000000_remove_team_member_role.sql", "utf8");
  const second = readFileSync("supabase/migrations/20261105000001_director_role_needs_directorship.sql", "utf8");
  const statement = `begin; set local lock_timeout='3s';
    drop trigger team_members_director_needs_directorship on public.team_members;
    drop function public.refuse_director_row_without_directorship();
    drop function public.remove_team_member_role(uuid, uuid);
    ${first}
    ${second}
    select has_function_privilege('authenticated', 'public.remove_team_member_role(uuid,uuid)', 'execute'),
      has_function_privilege('anon', 'public.remove_team_member_role(uuid,uuid)', 'execute');
    rollback;`;
  const output = execFileSync("docker", ["exec", "-i", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: statement, encoding: "utf8" });
  expect(output).toContain("t|f");
});

it("a role edit cannot resurrect director access while the club removes that directorship", async () => {
  const { owner, director, orgId, teamId, memberId } = await setup();
  const tag = `pr159_${orgId.replaceAll("-", "")}`;
  const removing = execFileAsync("docker", ["exec", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", `begin; set application_name='${tag}'; select public.remove_org_director('${owner.user.id}', '${orgId}', '${director.user.id}'); select pg_sleep(8); commit;`]);
  try {
    let paused = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      paused = sql(`select exists(select 1 from pg_stat_activity where application_name='${tag}' and wait_event='PgSleep');`) === "t";
      if (paused) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(paused).toBe(true);
    // The directorship deletion is still uncommitted. This is exactly the
    // update performed by the new roster role editor.
    const changed = await owner.client.from("team_members").update({ role: "director" }).eq("id", memberId).select("role");
    await removing;
    const { data: directorship } = await adminClient.from("organization_members").select("role").eq("organization_id", orgId).eq("profile_id", director.user.id).maybeSingle();
    const { data: membership } = await adminClient.from("team_members").select("role").eq("id", memberId).single();
    const isAdmin = sql(`begin; select set_config('request.jwt.claim.sub','${director.user.id}',true); select public.is_team_admin('${teamId}'); rollback;`);
    console.log({ roleEditError: changed.error, directorship, membership, isAdmin });
    expect(directorship).toBeNull();
    expect(changed.error).not.toBeNull();
    expect(membership?.role).toBe("player");
  } finally {
    await removing;
  }
});

it("keeps a standalone free team's record-keeping owner out of the club-director flow", async () => {
  const owner = await createTestUser();
  const { data: teamId, error } = await adminClient.rpc("create_team", {
    owner_profile_id: owner.user.id,
    team_name: "PR159 standalone team",
    season: null,
    org_name: "PR159 standalone organization",
  });
  if (error) throw error;
  trackIds({ teamId });
  const { data: team } = await adminClient.from("teams").select("organization_id").eq("id", teamId).single();
  trackIds({ orgId: team!.organization_id });
  const { data: org } = await adminClient.from("organizations").select("plan").eq("id", team!.organization_id).single();
  const { data: row } = await adminClient.from("team_members").select("id").eq("team_id", teamId).eq("profile_id", owner.user.id).single();
  const offersDirector = await isClubAdminOfTeam(adminClient as never, teamId, owner.user.id);
  const removal = await owner.client.rpc("remove_team_member_role", { p_member_id: row!.id, p_team_id: teamId });
  console.log({ plan: org!.plan, offersDirector, removal: removal.data, error: removal.error });
  expect(org!.plan).toBe("free");
  expect(offersDirector).toBe(false);
  expect(removal.data).toBe("not_club_admin");
});

it("the team-creation API still enrolls the owner if a director leaves after its membership read", async () => {
  const { owner, director, orgId } = await setup("coach");
  api.user = owner.user;
  api.client = {
    from(table: string) {
      if (table !== "organization_members") return adminClient.from(table);
      // Return the real read result, but let the director's removal complete
      // before the route uses that snapshot for its later bulk insert.
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              return {
                async in(roleColumn: string, roles: string[]) {
                  const snapshot = await adminClient.from(table).select(columns).eq(column, value).in(roleColumn, roles);
                  const removed = await adminClient.rpc("remove_org_director", {
                    p_actor_id: owner.user.id, p_org_id: orgId, p_profile_id: director.user.id,
                  });
                  if (removed.error) throw removed.error;
                  return snapshot;
                },
              };
            },
          };
        },
      };
    },
  };
  const response = await createClubTeam(new Request("http://localhost/api/club/teams", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, teamName: "PR159 stale director snapshot" }),
  }));
  const body = await response.json();
  if (body.teamId) trackIds({ teamId: body.teamId });
  const { data: members } = await adminClient.from("team_members").select("profile_id, role").eq("team_id", body.teamId);
  console.log({ status: response.status, memberCount: members?.length, ownerEnrolled: members?.some((m) => m.profile_id === owner.user.id) });
  expect(response.status).toBe(201);
  expect(members?.some((m) => m.profile_id === owner.user.id)).toBe(true);
});
