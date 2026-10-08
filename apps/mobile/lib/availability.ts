/**
 * Availability on the event screen: the web's rules, copied (spec:
 * docs/specs/mobile-next-build.md §4, D1). Keep in step with
 * apps/web/src/lib/availability/status.ts and ResponseList in
 * apps/web/src/components/availability/response-list.tsx.
 *
 * One difference: each group is sorted by name here. The web lists the roster
 * in the order the database returns it.
 */

import { displayLabel } from "./labels";

export type AvailabilityStatus = "available" | "maybe" | "unavailable";

/** The answer a tap on `clicked` leads to: tapping the current answer clears it. */
export function nextAvailability(current: AvailabilityStatus | null, clicked: AvailabilityStatus) {
  return clicked === current ? null : clicked;
}

export type RosterMember = {
  profileId: string;
  name: string;
  /** Roster role. Only players count toward the responses; everyone else is staff. */
  role: string | null;
};

export type StaffResponse = RosterMember & { status: AvailabilityStatus | null; roleLabel: string };

const isPlayer = (m: RosterMember) => (m.role ?? "player") === "player";
const byName = (a: RosterMember, b: RosterMember) => a.name.localeCompare(b.name);

/**
 * Players grouped by answer, and staff with their answers. Answers from people
 * not on the roster (someone who left the team) are ignored, as on the web.
 */
export function groupResponses(roster: RosterMember[], answers: ReadonlyMap<string, AvailabilityStatus | null>) {
  const groups: Record<AvailabilityStatus | "none", RosterMember[]> = {
    available: [],
    maybe: [],
    unavailable: [],
    none: [],
  };
  const players = roster.filter(isPlayer).sort(byName);
  for (const m of players) groups[answers.get(m.profileId) ?? "none"].push(m);

  const staff: StaffResponse[] = roster
    .filter((m) => !isPlayer(m))
    .sort(byName)
    .map((m) => ({
      ...m,
      status: answers.get(m.profileId) ?? null,
      roleLabel: m.role ? displayLabel(m.role) : "Staff",
    }));

  const summary = [
    groups.available.length > 0 && `${groups.available.length} available`,
    groups.maybe.length > 0 && `${groups.maybe.length} maybe`,
    groups.unavailable.length > 0 && `${groups.unavailable.length} unavailable`,
  ]
    .filter(Boolean)
    .join(" · ");

  return { groups, staff, summary, playerCount: players.length };
}

export type Answerer = { profileId: string; name: string };

type MembershipLike = {
  team_id: string;
  profile_id: string;
  profiles: { first_name: string | null; last_name: string | null } | null;
};

/**
 * Who the event screen answers for (review of #105). An answer must be for a
 * profile on the event's team, or the database refuses it. The screen can open
 * any team's event (from a notification), so the profile being viewed may not
 * be on it.
 *
 * `choices` are your profiles (your own and the players you manage) on the
 * team. `answeringAs` is the one being viewed when it's among them, else the
 * only one, else null: several (siblings) means asking, none means no answer.
 */
export function answerersFor(
  teamId: string,
  memberships: MembershipLike[],
  viewingProfileId: string | null | undefined
): { answeringAs: string | null; choices: Answerer[] } {
  const choices: Answerer[] = [];
  for (const m of memberships) {
    if (m.team_id !== teamId || choices.some((c) => c.profileId === m.profile_id)) continue;
    const name = [m.profiles?.first_name, m.profiles?.last_name].filter(Boolean).join(" ") || "Unknown";
    choices.push({ profileId: m.profile_id, name });
  }
  choices.sort((a, b) => a.name.localeCompare(b.name));

  const viewing = choices.find((c) => c.profileId === viewingProfileId);
  const answeringAs = viewing?.profileId ?? (choices.length === 1 ? choices[0].profileId : null);
  return { answeringAs, choices };
}

export type EffectiveAnswer = {
  status: AvailabilityStatus | null;
  /** True when the answer is the tournament's, because the game has none of its own. */
  inherited: boolean;
};

/**
 * A game's answer, in a tournament (docs/specs/tournaments-and-leagues.md §4,
 * "Availability", D2): its own answer if there is one, else the tournament's,
 * else none. Clearing the game's own answer goes back to the tournament's. Keep
 * in step with apps/web/src/lib/availability/effective.ts.
 */
export function effectiveAnswer(
  own: AvailabilityStatus | null | undefined,
  tournament: AvailabilityStatus | null | undefined
): EffectiveAnswer {
  if (own) return { status: own, inherited: false };
  if (tournament) return { status: tournament, inherited: true };
  return { status: null, inherited: false };
}
