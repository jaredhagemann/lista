/**
 * Individual training tracking — shared constants and helpers.
 * Spec: docs/specs/individual-training-tracking.md
 */

/**
 * A managed training category — a row in `training_categories`. Categories are
 * per-team and coach-managed (one seeded "General" default + custom types); the
 * old hardcoded enum is gone. A session references one by `category_id`.
 */
export type CategoryRow = {
  id: string;
  label: string;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

/** The seeded default category present on every team; its label is immutable. */
export const DEFAULT_CATEGORY_LABEL = "General";

/** Label shown for a session whose category was removed with its team (SET NULL). */
export const MISSING_CATEGORY_LABEL = "—";

/**
 * Deterministic display order, mirroring the DB index and RPC ordering exactly:
 * default first, then sort_order, then created_at, then id — NOT label — so
 * concurrent additions that share a sort_order stay in a stable, spec-defined
 * order. (created_at is an ISO string; id is a uuid; both sort lexicographically.)
 */
export function sortCategories<T extends CategoryRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.is_default) - Number(a.is_default) ||
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
  );
}

/** Sports recognized by `teams.sport` (mirrors the CHECK constraint). */
export type Sport =
  | "baseball" | "basketball" | "cricket" | "field_hockey" | "flag_football"
  | "football" | "golf" | "gymnastics" | "ice_hockey" | "lacrosse"
  | "pickleball" | "rugby" | "soccer" | "softball" | "swimming"
  | "tennis" | "track_and_field" | "volleyball" | "wrestling" | "other";

/**
 * Sport-based category suggestions offered (one click) in the manage-categories
 * UI. Purely convenience — never enforced; a coach may accept, ignore, edit, or
 * add their own. Sports without an entry (incl. "other") show only "add custom".
 * Each list must have unique, ≤40-char labels (a unit test asserts this).
 */
export const SPORT_CATEGORY_SUGGESTIONS: Partial<Record<Sport, string[]>> = {
  soccer: ["Ball mastery", "Dribbling", "Passing", "Shooting", "Fitness", "Strength", "Agility", "Recovery"],
  basketball: ["Shooting", "Ball handling", "Finishing", "Footwork", "Conditioning", "Strength", "Recovery"],
  baseball: ["Hitting", "Fielding", "Throwing", "Base running", "Conditioning", "Strength", "Recovery"],
  softball: ["Hitting", "Fielding", "Throwing", "Base running", "Conditioning", "Strength", "Recovery"],
  football: ["Route running", "Strength", "Speed & agility", "Film study", "Conditioning", "Recovery"],
  flag_football: ["Route running", "Throwing", "Catching", "Speed & agility", "Conditioning", "Recovery"],
  volleyball: ["Serving", "Passing", "Setting", "Hitting", "Blocking", "Conditioning", "Recovery"],
  ice_hockey: ["Stickhandling", "Shooting", "Skating", "Passing", "Conditioning", "Strength", "Recovery"],
  field_hockey: ["Stickwork", "Passing", "Shooting", "Speed & agility", "Conditioning", "Recovery"],
  lacrosse: ["Cradling", "Passing", "Shooting", "Dodging", "Conditioning", "Strength", "Recovery"],
  tennis: ["Serve", "Forehand", "Backhand", "Volley", "Footwork", "Conditioning", "Recovery"],
  golf: ["Driving", "Irons", "Short game", "Putting", "Fitness", "Recovery"],
  rugby: ["Passing", "Tackling", "Kicking", "Speed & agility", "Strength", "Conditioning", "Recovery"],
  cricket: ["Batting", "Bowling", "Fielding", "Fitness", "Strength", "Recovery"],
  swimming: ["Technique", "Endurance", "Sprints", "Kick sets", "Strength", "Recovery"],
  track_and_field: ["Sprints", "Distance", "Technique", "Strength", "Plyometrics", "Recovery"],
  gymnastics: ["Strength", "Flexibility", "Technique", "Conditioning", "Recovery"],
  wrestling: ["Technique", "Conditioning", "Strength", "Live wrestling", "Recovery"],
  pickleball: ["Serve & return", "Dinking", "Volleys", "Footwork", "Conditioning", "Recovery"],
};

/** DB label length ceiling (mirrors the CHECK) for client-side validation. */
export const MAX_CATEGORY_LABEL_LENGTH = 40;

/** Case/space-insensitive label key, matching the DB's broad-trim unique index. */
export function normalizeLabelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Pure category-label validation shared by the client and the server action. */
export function validateCategoryLabel(
  raw: string
): { label: string } | { error: string } {
  const label = raw.trim();
  if (label.length < 1 || label.length > MAX_CATEGORY_LABEL_LENGTH) {
    return { error: `Name must be 1–${MAX_CATEGORY_LABEL_LENGTH} characters.` };
  }
  return { label };
}

/**
 * Pure prefetch-filter planner for "Add suggested categories": given a team's
 * existing categories and a sport's suggested labels, decide which to insert
 * (with appended sort_order), which are already active, and which match an
 * archived row (reported for explicit Restore, never silently reactivated).
 */
export function planSuggestedCategories(
  existing: { label: string; is_active: boolean; sort_order: number }[],
  suggestions: string[]
): {
  toInsert: { label: string; sort_order: number }[];
  alreadyActive: number;
  archived: string[];
} {
  const activeLabels = new Set(existing.filter((e) => e.is_active).map((e) => normalizeLabelKey(e.label)));
  const archivedLabels = new Set(existing.filter((e) => !e.is_active).map((e) => normalizeLabelKey(e.label)));
  let order = Math.max(0, ...existing.map((e) => e.sort_order)) + 10;

  const toInsert: { label: string; sort_order: number }[] = [];
  const archived: string[] = [];
  let alreadyActive = 0;

  for (const label of suggestions) {
    const key = normalizeLabelKey(label);
    if (activeLabels.has(key)) {
      alreadyActive++;
    } else if (archivedLabels.has(key)) {
      archived.push(label);
    } else {
      toInsert.push({ label, sort_order: order });
      order += 10;
    }
  }
  return { toInsert, alreadyActive, archived };
}

/** DB-enforced bounds — mirror the CHECK / trigger so the client can validate for UX. */
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 300; // per-session ceiling
export const MAX_DAILY_MINUTES = 360; // per player-day (all teams)
export const MAX_NOTES_LENGTH = 500;
export const BACKDATE_WINDOW_DAYS = 7; // log/edit/delete window

/**
 * Explanatory copy shown when a session has aged out of the edit/delete window
 * and is read-only to the player (spec: "the UI shows why — e.g. a disabled
 * control with 'Older than 7 days — ask a coach to change this.'").
 */
export const OLD_SESSION_LOCKED_LABEL =
  "Older than 7 days — ask a coach to change this.";

/** Duration quick-pick chips for the log dialog. */
export const DURATION_QUICK_PICKS = [15, 30, 45, 60] as const;

export type LeaderboardScope = "team" | "club";
export type LeaderboardPeriod = "week" | "month";

// ── Period math ─────────────────────────────────────────────────────────────
// All in UTC so bare-date arithmetic never drifts across a timezone boundary —
// this mirrors the timezone-naive `date_trunc` bucketing in the leaderboard RPC.
// Anchors and dates are "YYYY-MM-DD" strings (any date inside the target period).

function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in the given IANA timezone (falls back to UTC). */
export function todayInTz(timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Monday of the anchor's week (YYYY-MM-DD). */
export function weekStartStr(anchor: string): string {
  const d = parseDate(anchor);
  const mondayOffset = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return toDateStr(d);
}

/** First day of the anchor's month (YYYY-MM-DD). */
export function monthStartStr(anchor: string): string {
  const d = parseDate(anchor);
  return toDateStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** The canonical start-of-period for the given period. */
export function periodStartStr(period: LeaderboardPeriod, anchor: string): string {
  return period === "week" ? weekStartStr(anchor) : monthStartStr(anchor);
}

/** Step the anchor one period back (-1) or forward (+1). */
export function stepAnchor(
  period: LeaderboardPeriod,
  anchor: string,
  direction: -1 | 1
): string {
  const d = parseDate(anchor);
  if (period === "week") {
    d.setUTCDate(d.getUTCDate() + direction * 7);
  } else {
    d.setUTCMonth(d.getUTCMonth() + direction);
  }
  return toDateStr(d);
}

/** Human label: "Jul 7 – Jul 13" for a week, "July 2026" for a month. */
export function periodLabel(period: LeaderboardPeriod, anchor: string): string {
  if (period === "week") {
    const start = parseDate(weekStartStr(anchor));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
    return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
  }
  return parseDate(monthStartStr(anchor)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * True when the anchor's period is the current one or later — used to disable
 * the forward ("next period") arrow, since a future board is always empty.
 */
export function isCurrentPeriodOrLater(
  period: LeaderboardPeriod,
  anchor: string,
  today: string
): boolean {
  return periodStartStr(period, anchor) >= periodStartStr(period, today);
}
