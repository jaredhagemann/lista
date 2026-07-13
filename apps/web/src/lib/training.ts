/**
 * Individual training tracking — shared constants and helpers.
 * Spec: docs/specs/individual-training-tracking.md
 */

/**
 * Training session categories. This list is the client-side source of truth for
 * the category picker and validation, and it **must** stay in lockstep with the
 * `training_sessions.category` CHECK constraint in
 * `supabase/migrations/20260713000000_training_sessions.sql`. A unit test asserts
 * the two agree (the same drift guard as `has_club_access`/`hasClubAccess`), so
 * change both together in one reviewed place.
 */
export const TRAINING_CATEGORIES = [
  "ball_mastery",
  "dribbling",
  "passing",
  "shooting",
  "fitness",
  "strength",
  "agility",
  "recovery",
  "other",
] as const;

export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

/** Human-readable labels for the category picker. */
export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  ball_mastery: "Ball mastery",
  dribbling: "Dribbling",
  passing: "Passing",
  shooting: "Shooting",
  fitness: "Fitness",
  strength: "Strength",
  agility: "Agility",
  recovery: "Recovery",
  other: "Other",
};

export function isTrainingCategory(value: string): value is TrainingCategory {
  return (TRAINING_CATEGORIES as readonly string[]).includes(value);
}

/** DB-enforced bounds — mirror the CHECK / trigger so the client can validate for UX. */
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 300; // per-session ceiling
export const MAX_DAILY_MINUTES = 360; // per player-day (all teams)
export const MAX_NOTES_LENGTH = 500;
export const BACKDATE_WINDOW_DAYS = 7; // log/edit/delete window

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
