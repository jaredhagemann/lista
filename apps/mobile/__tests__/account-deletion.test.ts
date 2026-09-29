/**
 * What the app says when the server refuses to delete an account (BUG-028).
 *
 * /api/account/delete answers 409 with a reason. The app knew "sole_guardian"
 * and treated every other refusal as owning teams, so a club owner was told to
 * transfer their teams and sent to Team Settings, which couldn't help. Each
 * reason now gets its own message and a way forward.
 */

import { deletionRefusal } from "../lib/account-deletion";

const API = "https://lista.team";

describe("deletionRefusal", () => {
  it("a club owner is told to hand the club over or close it, with a link to Club Settings on the web", () => {
    const refusal = deletionRefusal({ error: "owns_club", clubs: ["SLOFC"] }, API);

    expect(refusal.message).toContain("SLOFC");
    expect(refusal.message).toMatch(/hand .* over to one of its directors, or close it/i);
    expect(refusal.message).not.toMatch(/team\(s\)/);
    expect(refusal.action).toEqual({ label: "Club Settings (web)", url: `${API}/dashboard/club/settings` });
  });

  it("names every club when there's more than one", () => {
    expect(deletionRefusal({ error: "owns_club", clubs: ["SLOFC", "Rec FC"] }, API).message).toContain(
      "SLOFC and Rec FC"
    );
  });

  it("a team owner is told which teams, and offered Team Settings", () => {
    const refusal = deletionRefusal({ error: "owns_teams", teams: ["12U Girls"] }, API);

    expect(refusal.message).toContain("12U Girls");
    expect(refusal.action).toEqual({ label: "Team Settings", route: "/(app)/settings/team" });
  });

  it("the only guardian who can sign in is told which players, and offered Managed Players", () => {
    const refusal = deletionRefusal({ error: "sole_guardian", players: ["Ava Chen"] }, API);

    expect(refusal.message).toContain("Ava Chen");
    expect(refusal.action).toEqual({ label: "Managed Players", route: "/(app)/settings/managed-players" });
  });

  it("an unknown reason gets a general message, not a guess, and no button", () => {
    const refusal = deletionRefusal({ error: "something_new" }, API);

    expect(refusal.message).not.toMatch(/owner|club|guardian|transfer/i);
    expect(refusal.action).toBeNull();
  });
});
