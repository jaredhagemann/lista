/**
 * A game's answer, in a tournament (docs/specs/tournaments-and-leagues.md §4,
 * "Availability", D2).
 *
 * People answer the tournament, and can answer one of its games to override it
 * ("can't make Sunday's games"). Both are plain `availability` rows: the
 * tournament's is the main answer, a game's own row an override. A game's answer
 * is its own row if there is one, else the tournament's, else none. Clearing a
 * game's own answer goes back to the tournament's; it never means "no answer".
 *
 * The phone applies the same rule (part 3), with the same cases.
 */

import type { AvailabilityStatus } from "@/lib/availability/status";

export type EffectiveAnswer = {
  status: AvailabilityStatus | null;
  /** True when the answer is the tournament's, because the game has none of its own. */
  inherited: boolean;
};

export function effectiveAnswer(
  own: AvailabilityStatus | null | undefined,
  tournament: AvailabilityStatus | null | undefined
): EffectiveAnswer {
  if (own) return { status: own, inherited: false };
  if (tournament) return { status: tournament, inherited: true };
  return { status: null, inherited: false };
}
