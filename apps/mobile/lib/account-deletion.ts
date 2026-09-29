/**
 * What the app says when the server refuses to delete an account (BUG-028).
 *
 * /api/account/delete answers 409 with one reason at a time. Each gets its own
 * message and a way forward: an in-app screen, or for a club (managed on the
 * web only) the web page, as Apple allows for finishing a deletion (5.1.1(v)).
 */

export type DeletionRefusalBody = {
  error?: string;
  clubs?: string[];
  teams?: string[];
  players?: string[];
};

export type DeletionRefusal = {
  title: string;
  message: string;
  action: { label: string; route: string } | { label: string; url: string } | null;
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
    case "owns_club":
      return {
        title,
        message:
          `You are the owner of ${names(body.clubs) || "a club"}. Hand the club over to one of its directors, ` +
          "or close it, before deleting your account. You can do that in Club Settings on the web.",
        action: { label: "Club Settings (web)", url: `${apiUrl}/dashboard/club/settings` },
      };
    case "owns_teams":
      return {
        title,
        message: `You are the owner of ${names(body.teams) || "a team"}. Transfer or delete the team before deleting your account.`,
        action: { label: "Team Settings", route: "/(app)/settings/team" },
      };
    case "sole_guardian":
      return {
        title,
        message: `You are the only guardian who can sign in for ${names(body.players)}. Invite another guardian before deleting your account.`,
        action: { label: "Managed Players", route: "/(app)/settings/managed-players" },
      };
    default:
      return {
        title,
        message: "Your account can't be deleted right now. Please try again, or contact support@lista.team.",
        action: null,
      };
  }
}
