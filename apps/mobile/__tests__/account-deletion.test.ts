/**
 * What the app says when the server refuses to delete an account (BUG-028).
 *
 * /api/account/delete answers 409 with a reason. The app knew "sole_guardian"
 * and treated every other refusal as owning teams, so a club owner was told to
 * transfer their teams and sent to Team Settings, which couldn't help. Each
 * reason now gets its own message and a way forward.
 *
 * Review: a club link must name the club. /dashboard/club/settings opens the
 * club of the browser's active team, which may be another club or none.
 */

import { deletionRefusal } from "../lib/account-deletion";

const API = "https://lista.team";

describe("deletionRefusal", () => {
  it("a club owner is told to hand the club over or close it, with a link to that club's settings on the web", () => {
    const refusal = deletionRefusal(
      { error: "owns_club", clubs: ["SLOFC"], ownedClubs: [{ id: "org-1", name: "SLOFC" }] },
      API
    );

    expect(refusal.message).toContain("SLOFC");
    expect(refusal.message).toMatch(/hand .* over to one of its directors, or close it/i);
    expect(refusal.message).not.toMatch(/team\(s\)/);
    expect(refusal.actions).toEqual([
      { label: "Club Settings (web)", url: `${API}/dashboard/club/open?org=org-1` },
    ]);
  });

  it("names every club when there's more than one, with a link for each", () => {
    const refusal = deletionRefusal(
      {
        error: "owns_club",
        clubs: ["SLOFC", "Rec FC"],
        ownedClubs: [
          { id: "org-1", name: "SLOFC" },
          { id: "org-2", name: "Rec FC" },
        ],
      },
      API
    );

    expect(refusal.message).toContain("SLOFC and Rec FC");
    expect(refusal.actions).toEqual([
      { label: "SLOFC (web)", url: `${API}/dashboard/club/open?org=org-1` },
      { label: "Rec FC (web)", url: `${API}/dashboard/club/open?org=org-2` },
    ]);
  });

  it("offers no club link it can't point at the right club", () => {
    const refusal = deletionRefusal({ error: "owns_club", clubs: ["SLOFC"] }, API);

    expect(refusal.message).toContain("SLOFC");
    expect(refusal.actions).toEqual([]);
  });

  it("escapes the club id in the link", () => {
    const refusal = deletionRefusal(
      { error: "owns_club", ownedClubs: [{ id: "a&b=c", name: "SLOFC" }] },
      API
    );

    expect(refusal.actions).toEqual([
      { label: "Club Settings (web)", url: `${API}/dashboard/club/open?org=a%26b%3Dc` },
    ]);
  });

  it("a team owner is told which teams, and offered Team Settings", () => {
    const refusal = deletionRefusal({ error: "owns_teams", teams: ["12U Girls"] }, API);

    expect(refusal.message).toContain("12U Girls");
    expect(refusal.actions).toEqual([{ label: "Team Settings", route: "/(app)/settings/team" }]);
  });

  it("the only guardian who can sign in is told which players, and offered Managed Players", () => {
    const refusal = deletionRefusal({ error: "sole_guardian", players: ["Ava Chen"] }, API);

    expect(refusal.message).toContain("Ava Chen");
    expect(refusal.actions).toEqual([{ label: "Managed Players", route: "/(app)/settings/managed-players" }]);
  });

  it("an unknown reason gets a general message, not a guess, and no button", () => {
    const refusal = deletionRefusal({ error: "something_new" }, API);

    expect(refusal.message).not.toMatch(/owner|club|guardian|transfer/i);
    expect(refusal.actions).toEqual([]);
  });
});
