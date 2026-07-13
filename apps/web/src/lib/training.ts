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
