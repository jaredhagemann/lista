// @vitest-environment jsdom
/**
 * Every click that navigates shows it was heard.
 *
 * A dashboard page renders on the server after its Supabase queries, and with
 * no loading.tsx anywhere the old page just sat there until the new one was
 * ready. Rows that navigate with router.push (a schedule event, a roster
 * member) weren't links, so nothing prefetched and nothing changed on click.
 *
 * Now every dashboard route has a loading skeleton, and every programmatic
 * navigation goes through useNavigate: the clicked row is marked busy and a
 * progress bar runs along the top until the next page is on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, act, use, useEffect, useState, type ReactNode } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// ── A router that takes a while ───────────────────────────────────────────────
//
// Next's router.push updates router state inside a transition, and the new
// route suspends until its server payload arrives; React keeps the old page up
// meanwhile. This stand-in does the same: push swaps in a page that suspends
// until the test lets it through.

const nav = vi.hoisted(() => ({
  go: (() => {}) as (href: string) => void,
  pushed: [] as string[],
  gate: { promise: Promise.resolve(), release: () => {} },
  searchParams: new URLSearchParams(),
}));

function newGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  nav.gate = { promise, release };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      nav.pushed.push(href);
      nav.go(href);
    },
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  // Stable, as in Next: a new object would read as a finished navigation.
  useSearchParams: () => nav.searchParams,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/events/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/queries")>()),
  fetchEventPage: vi.fn(async () => ({
    items: [scheduleEvent],
    nextCursor: null,
    hasNext: false,
  })),
}));

function NextPage() {
  use(nav.gate.promise);
  return <p>The next page</p>;
}

function FakeRouter({ children }: { children: ReactNode }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    nav.go = setHref;
  }, []);
  return <Suspense fallback={<p>Blank</p>}>{href ? <NextPage /> : children}</Suspense>;
}

import { ProgressBar } from "@/components/layout/progress-bar";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TeamRoster } from "@/components/team/team-roster";
import { ScheduleList } from "@/components/calendar/schedule-list";

function renderInApp(ui: ReactNode) {
  return render(
    <ProgressBar>
      <FakeRouter>{ui}</FakeRouter>
    </ProgressBar>
  );
}

const TEAM = "11111111-1111-1111-1111-111111111111";

const scheduleEvent = {
  id: "event-1",
  team_id: TEAM,
  title: "Tuesday practice",
  event_type: "practice",
  start_time: "2026-12-10T18:00:00.000Z",
  end_time: "2026-12-10T19:30:00.000Z",
  is_cancelled: false,
  location_id: null,
  locations: null,
  arrival_time: null,
  notes: null,
  opponent: null,
  home_away: null,
  uniform: null,
  game_result: null,
  score_for: null,
  score_against: null,
  recurrence_rule: null,
  parent_event_id: null,
  created_by: null,
  created_at: null,
};

const zoey = {
  id: "member-1",
  team_id: TEAM,
  profile_id: "p-1",
  role: "player",
  jersey_number: 7,
  position: null,
  profiles: { id: "p-1", first_name: "Zoey", last_name: "Butler", avatar_url: null },
} as never;

beforeEach(() => {
  nav.pushed = [];
  newGate();
});

afterEach(cleanup);

function progressBar() {
  return screen.queryByRole("progressbar", { name: "Loading page" });
}

// ── Clicks that navigate ──────────────────────────────────────────────────────

describe("clicking a roster member", () => {
  it("marks the row busy and shows the progress bar until the member's page is up", async () => {
    renderInApp(<TeamRoster members={[zoey]} isAdmin teamId={TEAM} />);

    const row = screen.getByText("Zoey Butler").closest("[aria-busy]")!;
    expect(row.getAttribute("aria-busy")).toBe("false");
    expect(progressBar()).toBeNull();

    // In an awaited act, so React can resume the suspended page when it is let through.
    await act(async () => screen.getByText("Zoey Butler").click());

    expect(nav.pushed).toEqual(["/dashboard/team/member-1"]);
    expect(screen.getByText("Zoey Butler").closest("[aria-busy]")!.getAttribute("aria-busy")).toBe("true");
    expect(progressBar()).not.toBeNull();

    await act(async () => {
      nav.gate.release();
      await nav.gate.promise;
    });

    await waitFor(() => expect(screen.getByText("The next page")).toBeTruthy());
    expect(progressBar()).toBeNull();
  });
});

describe("clicking a schedule event", () => {
  it("marks the row busy and shows the progress bar", async () => {
    const user = userEvent.setup();
    renderInApp(<ScheduleList teamId={TEAM} isAdmin team={{ name: "Test team" }} />);

    const title = await screen.findByText("Tuesday practice");
    expect(title.closest("tr")!.getAttribute("aria-busy")).toBe("false");

    await user.click(title);

    expect(nav.pushed).toEqual(["/dashboard/schedule/event-1"]);
    expect(screen.getByText("Tuesday practice").closest("tr")!.getAttribute("aria-busy")).toBe("true");
    expect(progressBar()).not.toBeNull();
  });
});

// ── Pages on their way ────────────────────────────────────────────────────────

describe("the loading skeleton", () => {
  it("tells assistive tech the page is loading", () => {
    render(<PageSkeleton />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });
});

// ── Source audit ──────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "src");

function files(dir: string, test: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, test);
    return test(path) ? [path] : [];
  });
}

describe("no navigation goes unacknowledged", () => {
  it("every dashboard route has a loading skeleton", () => {
    const pages = files(join(SRC, "app", "dashboard"), (p) => p.endsWith("page.tsx"));
    const missing = pages
      .filter((page) => !existsSync(join(dirname(page), "loading.tsx")))
      .map((page) => relative(SRC, dirname(page)));
    expect(missing).toEqual([]);
  });

  it("nothing calls router.push directly: useNavigate shows the wait", () => {
    const offenders = files(SRC, (p) => /\.tsx?$/.test(p))
      .filter((p) => !p.endsWith(join("layout", "navigation-progress.tsx")))
      .flatMap((p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .map((line, i) => ({ where: `${relative(SRC, p)}:${i + 1}`, line }))
      )
      .filter(({ line }) => /\brouter\.push\(/.test(line))
      .map(({ where, line }) => `${where}  ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
