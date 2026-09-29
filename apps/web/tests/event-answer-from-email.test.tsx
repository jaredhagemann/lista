// @vitest-environment jsdom
/**
 * Answering from an email (spec: docs/specs/email-upgrade.md §4.7, D7).
 *
 * An email's "✓ Available / ? Maybe / ✗ Unavailable" links open the event page
 * with ?answer=<status>&for=<profile>. The page records it as it opens, before
 * it reads the answers back, so what it shows already includes it. It says what
 * it did ("Ava is marked Available"), then takes the parameters out of the
 * address so a reload can't overwrite a later change. Nothing is recorded for
 * an event that has started or been cancelled, and a refusal from the database
 * (not yours to answer, not on the team) is explained, not hidden.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const log: string[] = [];
  const upserts: unknown[] = [];
  let upsertError: { message: string } | null = null;
  const from = (table: string) => {
    const result = () => {
      log.push(`read ${table}`);
      return Promise.resolve({ data: tables[table] ?? null, error: null });
    };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    chain.upsert = (row: unknown) => {
      log.push(`write ${table}`);
      upserts.push(row);
      return Promise.resolve({ error: upsertError });
    };
    return chain;
  };
  return {
    tables,
    log,
    upserts,
    setUpsertError: (e: { message: string } | null) => {
      upsertError = e;
    },
    membership: null as unknown,
    replace: vi.fn(),
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "gail" } } }) } },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/get-active-membership", () => ({ getActiveMembership: async () => mocks.membership }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/schedule/evt-1",
}));
vi.mock("@/components/calendar/event-detail", () => ({ EventDetail: () => null }));

import EventDetailPage from "@/app/dashboard/schedule/[eventId]/page";

const NOW = new Date("2026-10-01T12:00:00Z");
const EVENT = {
  id: "evt-1",
  team_id: "team-1",
  title: "Saturday game",
  event_type: "game",
  start_time: "2026-10-03T17:00:00Z",
  end_time: "2026-10-03T18:30:00Z",
  is_cancelled: false,
  profiles: null,
  locations: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.log.length = 0;
  mocks.upserts.length = 0;
  mocks.setUpsertError(null);
  // A guardian viewing as themselves, on the team through their players.
  mocks.membership = { team_id: "team-1", role: "player", profile_id: "gail", teams: { id: "team-1", name: "12U Girls" } };
  mocks.tables.events = EVENT;
  mocks.tables.profiles = { first_name: "Ava" };
  mocks.tables.availability = [];
  mocks.tables.team_members = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function open(query: Record<string, string>) {
  render(await EventDetailPage({ params: Promise.resolve({ eventId: "evt-1" }), searchParams: Promise.resolve(query) }));
}

describe("an answer link", () => {
  it("records the answer for that player, before reading the answers back, and says so", async () => {
    await open({ answer: "available", for: "ava" });

    expect(mocks.upserts).toEqual([{ event_id: "evt-1", profile_id: "ava", status: "available" }]);
    expect(mocks.log.indexOf("write availability")).toBeLessThan(mocks.log.indexOf("read availability"));
    expect(screen.getByRole("status").textContent).toContain("Ava is marked Available");
  });

  it("without a 'for', answers for whoever the viewer is answering as", async () => {
    await open({ answer: "maybe" });

    expect(mocks.upserts).toEqual([{ event_id: "evt-1", profile_id: "gail", status: "maybe" }]);
    expect(screen.getByRole("status").textContent).toContain("You're marked Maybe");
  });

  it("then takes the answer out of the address, keeping anything else", async () => {
    await open({ answer: "unavailable", for: "ava", switched: "1", edit: "true" });

    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/schedule/evt-1?edit=true");
  });

  it("records nothing for an event that has started", async () => {
    mocks.tables.events = { ...EVENT, start_time: "2026-10-01T11:00:00Z" };

    await open({ answer: "available", for: "ava" });

    expect(mocks.upserts).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/already started/);
  });

  it("records nothing for a cancelled event", async () => {
    mocks.tables.events = { ...EVENT, is_cancelled: true };

    await open({ answer: "available", for: "ava" });

    expect(mocks.upserts).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/cancelled/);
  });

  it("explains a refusal: not someone the viewer answers for", async () => {
    mocks.setUpsertError({ message: "new row violates row-level security policy" });

    await open({ answer: "available", for: "someone-else" });

    expect(screen.getByRole("status").textContent).toMatch(/couldn't record/i);
  });

  it("ignores an answer that isn't one", async () => {
    await open({ answer: "definitely", for: "ava" });

    expect(mocks.upserts).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
