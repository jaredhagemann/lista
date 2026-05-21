/**
 * Component-level tests for ClubTeamsClient — specifically the over-limit
 * warning banner that the spec mandates on the Teams page.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Over-Limit Downgrade"
 *       (and the matching Testing Checklist line "Large → Small with >10 teams:
 *        warning shown, downgrade allowed, team creation blocked after limit
 *        takes effect").
 *
 * The banner is keyed off three server-derived inputs:
 *
 *   plan             — `free | club_small | club_large | null`
 *   teamLimit        — `1 | 10 | null` (null = unlimited, club_large)
 *   activeTeamCount  — count of NON-archived teams in the org
 *
 * Active-only counting is load-bearing: the spec's banner copy advises owners
 * to "archive teams" as a remedy. If archived teams counted, archiving would
 * not relieve the over-limit state and the advice would be misleading. The
 * `create_club_team` RPC + POST /api/club/teams route count the same way
 * (migration 20260521000000_create_club_team_active_count.sql), so the banner
 * stays in lockstep with what the API enforces.
 *
 * Cases pinned here:
 *   - exact spec copy for free + club_small (verbatim — copy edits must update
 *     both the component and these tests)
 *   - banner suppressed for club_large (NULL limit) regardless of count
 *   - banner suppressed when active count is at or under the limit
 *   - banner suppressed for unknown / missing plan values
 *   - banner present for free@2 and club_small@11 (the "1 over" boundary)
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  ClubTeamsClient,
  overLimitMessage,
} from "@/components/club/club-teams-client";
import type { OrgPlan } from "@/lib/plan";

// ── Pure-function tests for overLimitMessage ────────────────────────────────

describe("overLimitMessage()", () => {
  it("returns the exact spec copy for a free org over its limit", () => {
    expect(overLimitMessage("free", 1, 2)).toBe(
      "You have 2 teams but your Free plan allows 1. Upgrade to add more, or archive teams to stay on Free.",
    );
  });

  it("returns the exact spec copy for a club_small org over its limit", () => {
    expect(overLimitMessage("club_small", 10, 11)).toBe(
      "You have 11 teams but Club Small allows 10. Archive teams or upgrade to Club Large to add more.",
    );
  });

  it("returns null when teamLimit is NULL (club_large is unlimited)", () => {
    expect(overLimitMessage("club_large", null, 500)).toBeNull();
  });

  it("returns null when active count is at the limit (not over)", () => {
    expect(overLimitMessage("club_small", 10, 10)).toBeNull();
    expect(overLimitMessage("free", 1, 1)).toBeNull();
  });

  it("returns null when active count is under the limit", () => {
    expect(overLimitMessage("club_small", 10, 9)).toBeNull();
    expect(overLimitMessage("free", 1, 0)).toBeNull();
  });

  it("returns null for an unknown plan even if the count is over the limit", () => {
    // Defensive: a partial-write or future plan should suppress the banner
    // rather than render an "undefined plan allows N" message.
    expect(overLimitMessage(null, 10, 11)).toBeNull();
    expect(
      overLimitMessage("legacy" as unknown as OrgPlan, 10, 11),
    ).toBeNull();
  });

  it("reflects the actual active count in the message (not a hardcoded value)", () => {
    expect(overLimitMessage("club_small", 10, 14)).toContain("You have 14 teams");
    expect(overLimitMessage("free", 1, 7)).toContain("You have 7 teams");
  });
});

// ── Render tests for the banner UI ───────────────────────────────────────────

const NO_TEAMS = {
  orgId: "org-1",
  teams: [],
  activeTeams: [],
  archivedTeams: [],
  showArchived: false,
};

describe("ClubTeamsClient — over-limit banner", () => {
  it("renders the banner with the Free copy when free org has 2 teams", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="free"
        teamLimit={1}
        activeTeamCount={2}
      />,
    );
    const banner = screen.getByTestId("over-limit-banner");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain(
      "You have 2 teams but your Free plan allows 1. Upgrade to add more, or archive teams to stay on Free.",
    );
  });

  it("renders the banner with the Club Small copy when club_small has 11 teams", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="club_small"
        teamLimit={10}
        activeTeamCount={11}
      />,
    );
    expect(screen.getByTestId("over-limit-banner").textContent).toContain(
      "You have 11 teams but Club Small allows 10. Archive teams or upgrade to Club Large to add more.",
    );
  });

  it("does not render the banner for a club_large org (NULL limit)", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="club_large"
        teamLimit={null}
        activeTeamCount={500}
      />,
    );
    expect(screen.queryByTestId("over-limit-banner")).toBeNull();
  });

  it("does not render the banner when active count equals the limit", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="club_small"
        teamLimit={10}
        activeTeamCount={10}
      />,
    );
    expect(screen.queryByTestId("over-limit-banner")).toBeNull();
  });

  it("does not render the banner when active count is under the limit", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="free"
        teamLimit={1}
        activeTeamCount={1}
      />,
    );
    expect(screen.queryByTestId("over-limit-banner")).toBeNull();
  });

  it("does not render the banner when plan is null (race / partial write)", () => {
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan={null}
        teamLimit={10}
        activeTeamCount={11}
      />,
    );
    expect(screen.queryByTestId("over-limit-banner")).toBeNull();
  });

  it("renders the banner above the Teams heading (persistent, top-of-page)", () => {
    // Spec: "A persistent warning banner is shown on the Teams page" — it
    // should appear before the page header so it is visible without scrolling.
    render(
      <ClubTeamsClient
        {...NO_TEAMS}
        plan="club_small"
        teamLimit={10}
        activeTeamCount={11}
      />,
    );
    const banner = screen.getByTestId("over-limit-banner");
    const heading = screen.getByRole("heading", { name: /teams/i });
    // DOCUMENT_POSITION_FOLLOWING (4) means heading is after the banner.
    expect(banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
