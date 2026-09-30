/**
 * How a game is named and its uniform shown: the web's rules, copied (spec:
 * docs/specs/mobile-next-build.md §4, D1). Keep in step with
 * apps/web/src/lib/events/game-display.ts.
 *
 * Left out: the uniform palette (the app doesn't edit uniforms), and the dark
 * theme and calendar chip backgrounds (the app has neither).
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
 * other event, keeps its stored title, as does a game whose team isn't loaded.
 */
export function gameTitle(
  event: TitledEvent,
  teamName: string | null | undefined,
  { includeScore = true }: { includeScore?: boolean } = {}
): string {
  const opponent = event.opponent?.trim();
  if (event.event_type !== "game" || !opponent || !teamName) return event.title;

  const title = `${teamName} ${event.home_away === "away" ? "@" : "vs"} ${opponent}`;
  const score = includeScore ? scoreLine(event) : null;
  return score ? `${title} · ${score}` : title;
}

/** "3–1" when both sides are set (0–0 included), else null. */
export function scoreLine(event: { score_for?: number | null; score_against?: number | null }): string | null {
  if (event.score_for == null || event.score_against == null) return null;
  return `${event.score_for}–${event.score_against}`;
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
export function uniformOf(which: string | null | undefined, team: TeamUniforms | null | undefined): Uniform | null {
  if (which !== "home" && which !== "away") return null;
  const name = (which === "home" ? team?.home_uniform : team?.away_uniform)?.trim();
  const color = which === "home" ? team?.home_uniform_color : team?.away_uniform_color;
  return {
    name: name || (which === "home" ? "Home uniform" : "Away uniform"),
    color: isHexColor(color) ? color : null,
  };
}

// ── Contrast ──────────────────────────────────────────────────────────────────

/** The white card a uniform pill sits on. */
export const PAGE_BACKGROUND = "#ffffff";

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
