/**
 * What the native app sends when accepting an invitation (BUG-011).
 *
 * The screen used to send `self` for every invitation that was not a "manage an
 * existing player" invite, so a parent accepting their child's player invitation
 * was enrolled as the player, with the child's birthday written onto the
 * parent's account.
 *
 * The choice is now explicit, and mirrors the web screen: am I the player, or am
 * I their guardian — and if guardian, is this a child I already manage or a new
 * one?
 */

export type Identity = "self" | "guardian";

export type AcceptBody =
  | { type: "manager" }
  | { type: "self" }
  | {
      type: "guardian";
      relationship: string;
      managedProfileId?: string;
    };

export type AcceptChoice = {
  isManagerInvite: boolean;
  /** A club director invitation (BUG-013): joining a club to help run it, not a team. */
  isDirectorInvite?: boolean;
  identity: Identity | null;
  relationship: string;
  /** A child the guardian already manages; empty means a new player. */
  existingChildId?: string;
};

export type BuildResult =
  | { ok: true; body: AcceptBody }
  | { ok: false; error: string };

export function buildAcceptBody(choice: AcceptChoice): BuildResult {
  // A "manage an existing player" invitation names the child already; there is
  // nothing to choose.
  if (choice.isManagerInvite) return { ok: true, body: { type: "manager" } };

  // A director joins the club as themselves, as the web accepts it (BUG-029).
  if (choice.isDirectorInvite) return { ok: true, body: { type: "self" } };

  if (choice.identity === null) {
    return { ok: false, error: "Tell us whether you are the player." };
  }

  if (choice.identity === "self") return { ok: true, body: { type: "self" } };

  if (!choice.relationship) {
    return { ok: false, error: "Select your relationship to the player." };
  }

  return {
    ok: true,
    body: {
      type: "guardian",
      relationship: choice.relationship,
      // Omitted rather than sent empty: the server reads "no id" as "a new player".
      ...(choice.existingChildId ? { managedProfileId: choice.existingChildId } : {}),
    },
  };
}

// ── What the screen says (BUG-029) ────────────────────────────────────────────

export type InviteSummary = { role: string; teamName: string; isManagerInvite: boolean };

export type InviteCopy = {
  /** Before signing in. */
  invitedAs: string;
  /** Under the team or club name. */
  roleLine: string;
  acceptLabel: string;
  /** After accepting. */
  joined: string;
  /** Whether to ask "are you the player, or their guardian?" (BUG-011). */
  asksWhoYouAre: boolean;
};

/** A stored role as people read it: "player" → "Player". */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * The invitation screen's words. A director invitation is to a club, whose name
 * the server sends as teamName (BUG-013): it's to help run it, and there's no
 * player to be. The app used to show it as a team invitation (BUG-029).
 */
export function inviteCopy(invite: InviteSummary): InviteCopy {
  if (invite.role === "director") {
    return {
      invitedAs: `You've been invited to help run ${invite.teamName} as a director`,
      roleLine: `Help run ${invite.teamName} as a director`,
      acceptLabel: "Accept & join club",
      joined: `You're now a director of ${invite.teamName}.`,
      asksWhoYouAre: false,
    };
  }
  if (invite.isManagerInvite) {
    return {
      invitedAs: "You've been invited to manage a player on this team",
      roleLine: "You've been invited to manage a player on this team",
      acceptLabel: "Accept & join team",
      joined: `You've joined ${invite.teamName}.`,
      asksWhoYouAre: false,
    };
  }
  return {
    invitedAs: `You've been invited as ${roleLabel(invite.role)}`,
    roleLine: `Role: ${roleLabel(invite.role)}`,
    acceptLabel: "Accept & join team",
    joined: `You've joined ${invite.teamName}.`,
    asksWhoYouAre: true,
  };
}
