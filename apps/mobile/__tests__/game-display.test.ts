/**
 * Game titles and uniforms, as on the web (spec: docs/specs/mobile-next-build.md
 * §1, the web's docs/specs/game-display-and-uniform-colors.md).
 *
 * The cases are the web's own (apps/web/tests/game-display.test.ts), less the
 * calendar chip and dark theme, which the app doesn't have.
 */

import {
  gameTitle,
  uniformOf,
  homeAwayLabel,
  scoreLine,
  contrastRatio,
  textColorOn,
  needsBorder,
  isHexColor,
  PAGE_BACKGROUND,
} from "../lib/game-display";

const game = (overrides: Record<string, unknown> = {}) => ({
  title: "Saturday game",
  event_type: "game",
  opponent: "Rivals FC" as string | null,
  home_away: "home" as string | null,
  score_for: null as number | null,
  score_against: null as number | null,
  ...overrides,
});

describe("gameTitle", () => {
  it("home, or home/away unset: [Team] vs [opponent]", () => {
    expect(gameTitle(game(), "U10 Girls")).toBe("U10 Girls vs Rivals FC");
    expect(gameTitle(game({ home_away: null }), "U10 Girls")).toBe("U10 Girls vs Rivals FC");
  });

  it("away: [Team] @ [opponent]", () => {
    expect(gameTitle(game({ home_away: "away" }), "U10 Girls")).toBe("U10 Girls @ Rivals FC");
  });

  it("adds the score when both sides are set, 0–0 included", () => {
    expect(gameTitle(game({ score_for: 3, score_against: 1 }), "U10 Girls")).toBe("U10 Girls vs Rivals FC · 3–1");
    expect(gameTitle(game({ score_for: 0, score_against: 0 }), "U10 Girls")).toBe("U10 Girls vs Rivals FC · 0–0");
  });

  it("shows no score when one side is missing", () => {
    expect(gameTitle(game({ score_for: 2 }), "U10 Girls")).toBe("U10 Girls vs Rivals FC");
  });

  it("includeScore: false leaves the score off", () => {
    expect(gameTitle(game({ score_for: 3, score_against: 1 }), "U10 Girls", { includeScore: false })).toBe(
      "U10 Girls vs Rivals FC"
    );
  });

  it("a game with no opponent keeps its own title", () => {
    expect(gameTitle(game({ opponent: null }), "U10 Girls")).toBe("Saturday game");
    expect(gameTitle(game({ opponent: "  " }), "U10 Girls")).toBe("Saturday game");
  });

  it("practices and other events keep their own title", () => {
    expect(gameTitle(game({ event_type: "practice", title: "Practice" }), "U10 Girls")).toBe("Practice");
    expect(gameTitle(game({ event_type: "other", title: "Team party" }), "U10 Girls")).toBe("Team party");
  });

  it("without the team's name, a game keeps its own title", () => {
    expect(gameTitle(game(), null)).toBe("Saturday game");
  });
});

describe("scoreLine", () => {
  it("is the score when both sides are set, 0–0 included", () => {
    expect(scoreLine({ score_for: 3, score_against: 1 })).toBe("3–1");
    expect(scoreLine({ score_for: 0, score_against: 0 })).toBe("0–0");
  });

  it("is null when either side is missing", () => {
    expect(scoreLine({ score_for: 3, score_against: null })).toBeNull();
    expect(scoreLine({ score_for: null, score_against: null })).toBeNull();
  });
});

describe("uniformOf", () => {
  const team = {
    home_uniform: "Navy",
    away_uniform: null,
    home_uniform_color: "#1e3a8a",
    away_uniform_color: "#ffffff",
  };

  it("names a uniform by the team's name for it, with its color", () => {
    expect(uniformOf("home", team)).toEqual({ name: "Navy", color: "#1e3a8a" });
  });

  it("falls back to 'Away uniform' when unnamed", () => {
    expect(uniformOf("away", team)).toEqual({ name: "Away uniform", color: "#ffffff" });
  });

  it("is null when the game has no uniform", () => {
    expect(uniformOf(null, team)).toBeNull();
    expect(uniformOf("striped", team)).toBeNull();
  });

  it("ignores a color that is not #rrggbb", () => {
    expect(uniformOf("home", { ...team, home_uniform_color: "red" })).toEqual({ name: "Navy", color: null });
  });

  it("names the uniform without the team loaded", () => {
    expect(uniformOf("home", null)).toEqual({ name: "Home uniform", color: null });
  });
});

describe("homeAwayLabel", () => {
  it("reads as people say it", () => {
    expect(homeAwayLabel("home")).toBe("Home");
    expect(homeAwayLabel("away")).toBe("Away");
    expect(homeAwayLabel(null)).toBe("—");
  });
});

describe("colors", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#1e3a8a")).toBe(true);
    for (const bad of ["red", "#fff", "#GGGGGG", "1e3a8a", "#1E3A8A0", null]) expect(isHexColor(bad)).toBe(false);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("puts black text on white and gold, white text on navy and black", () => {
    expect(textColorOn("#ffffff")).toBe("#000000");
    expect(textColorOn("#eab308")).toBe("#000000");
    expect(textColorOn("#1e3a8a")).toBe("#ffffff");
    expect(textColorOn("#111111")).toBe("#ffffff");
  });

  it("borders a pill that would disappear into the white card", () => {
    expect(needsBorder("#ffffff", PAGE_BACKGROUND)).toBe(true);
    expect(needsBorder("#1e3a8a", PAGE_BACKGROUND)).toBe(false);
  });
});
