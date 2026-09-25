/**
 * How a game is named and its uniform shown, on every web view
 * (spec: docs/specs/game-display-and-uniform-colors.md).
 */

// ── Game titles ───────────────────────────────────────────────────────────────

type TitledEvent = {
  title: string;
  event_type: string;
  opponent?: string | null;
  home_away?: string | null;
  score_for?: number | null;
  score_against?: number | null;
};

/**
 * "[Team] vs [opponent]" for a home game (or one with home/away unset),
 * "[Team] @ [opponent]" for an away game, with " · 3–1" when both scores are
 * set (0–0 included) and `includeScore` is on. A game with no opponent, and any
 * other event, keeps its stored title.
 */
export function gameTitle(
  event: TitledEvent,
  teamName: string,
  { includeScore = true }: { includeScore?: boolean } = {}
): string {
  const opponent = event.opponent?.trim();
  if (event.event_type !== "game" || !opponent) return event.title;

  const title = `${teamName} ${event.home_away === "away" ? "@" : "vs"} ${opponent}`;
  if (includeScore && event.score_for != null && event.score_against != null) {
    return `${title} · ${event.score_for}–${event.score_against}`;
  }
  return title;
}

/** "Home" / "Away", as people say it; "—" when unset. */
export function homeAwayLabel(value: string | null | undefined): string {
  if (value === "home") return "Home";
  if (value === "away") return "Away";
  return "—";
}

// ── Uniforms ──────────────────────────────────────────────────────────────────

export type Uniform = { name: string; color: string | null };

export type TeamUniforms = {
  home_uniform?: string | null;
  away_uniform?: string | null;
  home_uniform_color?: string | null;
  away_uniform_color?: string | null;
};

/**
 * The uniform a game wears, by the team's name for it ("Home uniform" /
 * "Away uniform" when unnamed) and its color. Null when the game has none.
 */
export function uniformOf(which: string | null | undefined, team: TeamUniforms): Uniform | null {
  if (which !== "home" && which !== "away") return null;
  const name = (which === "home" ? team.home_uniform : team.away_uniform)?.trim();
  const color = which === "home" ? team.home_uniform_color : team.away_uniform_color;
  return {
    name: name || (which === "home" ? "Home uniform" : "Away uniform"),
    color: isHexColor(color) ? color : null,
  };
}

/** The kit colors offered in team settings. */
export const UNIFORM_PALETTE = [
  { name: "White", hex: "#ffffff" },
  { name: "Black", hex: "#111111" },
  { name: "Gray", hex: "#6b7280" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Royal", hex: "#2563eb" },
  { name: "Sky", hex: "#38bdf8" },
  { name: "Red", hex: "#dc2626" },
  { name: "Maroon", hex: "#7f1d1d" },
  { name: "Green", hex: "#15803d" },
  { name: "Gold", hex: "#eab308" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Purple", hex: "#7c3aed" },
] as const;

// ── Contrast ──────────────────────────────────────────────────────────────────

/**
 * What a uniform color sits on, per theme, as hex. The page is the card color in
 * each theme (globals.css: --card); the game chip is the calendar's green
 * (green-100 light; green-900 at 40% over the dark background).
 */
export const BACKGROUNDS = {
  page: { light: "#ffffff", dark: "#171717" },
  gameChip: { light: "#dcfce7", dark: "#0e2718" },
} as const;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the fill. */
export function textColorOn(fill: string): "#000000" | "#ffffff" {
  return contrastRatio(fill, "#000000") >= contrastRatio(fill, "#ffffff") ? "#000000" : "#ffffff";
}

/** Whether a fill would disappear into its background without an outline. */
export function needsBorder(fill: string, background: string): boolean {
  return contrastRatio(fill, background) < 1.5;
}
