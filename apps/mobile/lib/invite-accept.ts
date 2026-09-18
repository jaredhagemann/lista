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
