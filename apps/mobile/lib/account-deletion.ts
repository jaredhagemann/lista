/**
 * What the app says when the server refuses to delete an account (BUG-028).
 *
 * /api/account/delete answers 409 with one reason at a time. Each gets its own
 * message and a way forward: an in-app screen, or for a club (managed on the
 * web only) the web page, as Apple allows for finishing a deletion (5.1.1(v)).
 *
 * A club link names the club: /dashboard/club/settings opens the club of the
 * browser's active team, which may be another club or none. The web's
 * /dashboard/club/open checks the viewer runs the named club and switches to it.
 */

export type DeletionRefusalBody = {
  error?: string;
  clubs?: string[];
  ownedClubs?: Array<{ id: string; name: string }>;
  teams?: string[];
  players?: string[];
};

export type DeletionAction = { label: string; route: string } | { label: string; url: string };

export type DeletionRefusal = {
  title: string;
  message: string;
  actions: DeletionAction[];
};

/** "A", "A and B", "A, B and C". */
function names(list: string[] | undefined): string {
  const items = (list ?? []).filter(Boolean);
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function deletionRefusal(body: DeletionRefusalBody, apiUrl: string): DeletionRefusal {
  const title = "Cannot Delete Account";
  switch (body.error) {
    case "owns_club": {
      const clubs = (body.ownedClubs ?? []).filter((c) => c.id);
      return {
        title,
        message:
          `You are the owner of ${names(body.clubs ?? clubs.map((c) => c.name)) || "a club"}. Hand the club over ` +
          "to one of its directors, or close it, before deleting your account. You can do that in Club Settings on the web.",
        actions: clubs.map((club) => ({
          label: clubs.length === 1 ? "Club Settings (web)" : `${club.name} (web)`,
          url: `${apiUrl}/dashboard/club/open?org=${encodeURIComponent(club.id)}`,
        })),
      };
    }
    case "owns_teams":
      return {
        title,
        message: `You are the owner of ${names(body.teams) || "a team"}. Transfer or delete the team before deleting your account.`,
        actions: [{ label: "Team Settings", route: "/(app)/settings/team" }],
      };
    case "sole_guardian":
      return {
        title,
        message: `You are the only guardian who can sign in for ${names(body.players)}. Invite another guardian before deleting your account.`,
        actions: [{ label: "Managed Players", route: "/(app)/settings/managed-players" }],
      };
    default:
      return {
        title,
        message: "Your account can't be deleted right now. Please try again, or contact support@lista.team.",
        actions: [],
      };
  }
}
