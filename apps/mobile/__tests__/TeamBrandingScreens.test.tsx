/**
 * Where club branding and labels show (spec: docs/specs/mobile-next-build.md §1).
 *
 * The top strip and the team picker name a club team "[club] - [team]" and show
 * the club's logo when the team has none of its own, as the web's header and
 * team picker do. Roles and relationships read capitalized ("Coach", "Mom").
 */

import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-svg", () => {
  const { View } = require("react-native");
  return { SvgUri: (props: Record<string, unknown>) => <View testID="svg-logo" {...props} /> };
});

const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-images/org-1/logo?t=1";
const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: CLUB_LOGO, plan: "club_small" };
const FREE = { name: "Rec Soccer", org_name_public: null, logo_url: null, plan: "free" };

const profile = (id: string, first: string) => ({
  id,
  first_name: first,
  last_name: "Chen",
  email: null,
  avatar_url: null,
  active_team_id: "t-club",
  birthday: null,
  gender: null,
});

function member(id: string, teamId: string, profileId: string, role: string, organizations: unknown, name: string) {
  return {
    id,
    team_id: teamId,
    profile_id: profileId,
    role,
    teams: { id: teamId, name, season: null, logo_url: null, home_uniform: null, away_uniform: null, organizations },
    profiles: profile(profileId, profileId === "me" ? "Dana" : "Ava"),
  };
}

const CLUB_ME = member("m-1", "t-club", "me", "coach", SLOFC, "12U Girls");
const CLUB_KID = member("m-2", "t-club", "kid", "player", SLOFC, "12U Girls");
const FREE_ME = member("m-3", "t-free", "me", "parent", FREE, "Rec Soccer");

const mockCtx = {
  membership: {
    profileId: "me",
    teamId: "t-club",
    teamName: "12U Girls",
    displayName: "SLOFC - 12U Girls",
    season: null,
    logoUrl: CLUB_LOGO,
    role: "coach",
    homeUniform: null,
    awayUniform: null,
  },
  ownProfile: profile("me", "Dana"),
  activeProfile: profile("me", "Dana"),
  allMemberships: [CLUB_ME, CLUB_KID, FREE_ME],
  managedProfiles: [{ managed_id: "kid", relationship: "step parent", profiles: profile("kid", "Ava") }],
  profilesOnActiveTeam: [CLUB_ME, CLUB_KID],
  loading: false,
  switching: false,
  switchTeam: jest.fn(),
  switchProfile: jest.fn(),
  refresh: jest.fn(),
};

jest.mock("../contexts/AppContext", () => ({ useAppContext: () => mockCtx }));

import { SwitcherSheet } from "../components/SwitcherSheet";
import { TeamProfileStrip } from "../components/TeamProfileStrip";

// The club's logo is an SVG, as the web's uploader allows: the screens must draw
// it, not hand it to Image (review of #102).
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/svg+xml" : null) },
  })) as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the top strip", () => {
  it("names the club team with its club and draws the club's SVG logo", async () => {
    render(<TeamProfileStrip />);

    expect(screen.getByText("SLOFC - 12U Girls")).toBeTruthy();
    expect((await screen.findByTestId("svg-logo")).props.uri).toBe(CLUB_LOGO);
  });
});

describe("the team picker", () => {
  function open() {
    render(<SwitcherSheet visible onClose={jest.fn()} onCreateTeam={jest.fn()} />);
  }

  it("names a club team with its club, a free team plainly, and draws the club's SVG logo", async () => {
    open();

    expect(screen.getByText("SLOFC - 12U Girls")).toBeTruthy();
    expect(screen.getByText("Rec Soccer")).toBeTruthy();
    expect(screen.queryByText(/ - Rec Soccer/)).toBeNull();
    const logos = await screen.findAllByTestId("svg-logo");
    expect(logos.map((l) => l.props.uri)).toEqual([CLUB_LOGO]);
    expect(screen.getByText("RS")).toBeTruthy(); // the free team, without a logo: initials
  });

  it("shows roles and relationships capitalized", () => {
    open();

    expect(screen.getByText("Parent")).toBeTruthy(); // the free team's row: one profile, the role
    expect(screen.getByText("Coach · You")).toBeTruthy();
    expect(screen.getByText("Player · Step Parent")).toBeTruthy();
  });
});
