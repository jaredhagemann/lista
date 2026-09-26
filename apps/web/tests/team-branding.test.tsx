// @vitest-environment jsdom
/**
 * Club teams wear their club's branding (spec: docs/specs/team-branding-and-labels.md §2–4).
 *
 * A team on a club plan inherits the club's logo unless it has its own, and is
 * named "[club] - [team]" in the team picker. The header's top left shows the
 * active team's logo, larger (72px in a 96px header), falling back to the
 * club's subdomain logo and then the wordmark. Free teams have an organization
 * too, but no club branding.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/app/actions/team", () => ({ setActiveTeam: vi.fn() }));
vi.mock("@/components/team/create-team-form", () => ({ CreateTeamForm: () => null }));

import { teamBranding } from "@/lib/team-branding";
import { TeamSwitcher } from "@/components/team/team-switcher";
import { DashboardNav } from "@/components/layout/dashboard-nav";

const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-logos/slofc.png";
const TEAM_LOGO = "https://x.supabase.co/storage/v1/object/public/team-images/t1.png";

const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: CLUB_LOGO, plan: "club_small" };

afterEach(cleanup);

// ── The rule ──────────────────────────────────────────────────────────────────

describe("teamBranding", () => {
  it("a club team without its own logo inherits the club's, and is prefixed by the club's public name", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: null, organizations: SLOFC })).toEqual({
      logoUrl: CLUB_LOGO,
      displayName: "SLOFC - 12U Girls",
      clubName: "SLOFC",
    });
  });

  it("a team's own logo beats the club's", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: TEAM_LOGO, organizations: SLOFC }).logoUrl).toBe(TEAM_LOGO);
  });

  it("without a public name, the club's internal name prefixes the team", () => {
    expect(
      teamBranding({ name: "12U Girls", logo_url: null, organizations: { ...SLOFC, org_name_public: null } }).displayName
    ).toBe("San Luis Obispo FC - 12U Girls");
  });

  it("a free team's organization lends neither logo nor name", () => {
    const free = { name: "12U Girls", logo_url: null, plan: "free", org_name_public: null };
    expect(teamBranding({ name: "12U Girls", logo_url: null, organizations: free })).toEqual({
      logoUrl: null,
      displayName: "12U Girls",
      clubName: null,
    });
  });

  it("a team with no organization loaded is just itself", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: TEAM_LOGO })).toEqual({
      logoUrl: TEAM_LOGO,
      displayName: "12U Girls",
      clubName: null,
    });
  });
});

// ── Where it shows ────────────────────────────────────────────────────────────

function membership(teamId: string, team: Record<string, unknown>, role = "coach") {
  return {
    id: `m-${teamId}`,
    team_id: teamId,
    profile_id: "u-1",
    role,
    created_at: null,
    teams: { id: teamId, season: null, ...team },
  } as never;
}

const CLUB_TEAM = membership("t-1", { name: "12U Girls", logo_url: null, organizations: SLOFC });
const FREE_TEAM = membership("t-2", { name: "Rec Soccer", logo_url: null, organizations: { name: "Rec Soccer", org_name_public: null, logo_url: null, plan: "free" } });

describe("the team picker", () => {
  it("names a club team with its club and shows the inherited logo", async () => {
    const user = userEvent.setup();
    render(<TeamSwitcher allMemberships={[CLUB_TEAM, FREE_TEAM]} activeMembership={CLUB_TEAM} />);

    const trigger = screen.getByRole("button", { name: /SLOFC - 12U Girls/ });
    expect(within(trigger).getByRole("img").getAttribute("src")).toBe(CLUB_LOGO);

    await user.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("SLOFC - 12U Girls")).toBeTruthy();
    expect(within(menu).getByText("Rec Soccer")).toBeTruthy();
    expect(within(menu).queryByText(/ - Rec Soccer/)).toBeNull();
  });
});

describe("the header's top left", () => {
  /** The top-left logo: the image in the home link (the team picker shows one too). */
  function topLeftLogo() {
    return screen.getAllByRole("img").find((img) => img.closest("a[href='/dashboard']"));
  }

  function renderNav(active: unknown, tenantLogo: string | null = null) {
    return render(
      <DashboardNav
        ownProfile={null}
        activeProfile={null}
        allMemberships={[CLUB_TEAM, FREE_TEAM]}
        activeMembership={active as never}
        profilesOnActiveTeam={[]}
        logoUrl={tenantLogo}
      />
    );
  }

  it("shows the active team's logo, large, in a taller header", () => {
    renderNav(membership("t-3", { name: "14U Boys", logo_url: TEAM_LOGO, organizations: SLOFC }));

    const logo = topLeftLogo()!;
    expect(logo.getAttribute("src")).toBe(TEAM_LOGO);
    expect(logo.getAttribute("alt")).toBe("SLOFC - 14U Boys logo");
    expect(logo.className).toContain("h-18");
    expect(screen.getByRole("banner").firstElementChild?.className).toContain("h-24");
  });

  it("a club team without its own logo shows the club's", () => {
    renderNav(CLUB_TEAM);

    expect(topLeftLogo()?.getAttribute("src")).toBe(CLUB_LOGO);
  });

  it("with no team logo, falls back to the club subdomain's logo", () => {
    renderNav(FREE_TEAM, CLUB_LOGO);

    expect(topLeftLogo()?.getAttribute("src")).toBe(CLUB_LOGO);
  });

  it("with neither, shows the wordmark", () => {
    renderNav(FREE_TEAM);

    expect(screen.getByText("lista")).toBeTruthy();
  });
});
