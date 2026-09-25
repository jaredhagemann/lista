/**
 * Game titles and uniform colors (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * gameTitle names a game "[Team] vs [opponent]" (home, or home/away unset) or
 * "[Team] @ [opponent]" (away), with the score when both sides are set; games
 * without an opponent and every other event keep their stored title.
 *
 * Uniform colors are shown on a filled pill whose text is black or white,
 * whichever contrasts better, with a border when the fill would disappear into
 * what it sits on — checked per theme, and against the green game chip for the
 * calendar dot.
 */

import { describe, it, expect } from "vitest";
import {
  gameTitle,
  uniformOf,
  homeAwayLabel,
  contrastRatio,
  textColorOn,
  needsBorder,
  isHexColor,
  BACKGROUNDS,
  UNIFORM_PALETTE,
} from "@/lib/events/game-display";

const game = (overrides: Record<string, unknown> = {}) => ({
  title: "Saturday game",
  event_type: "game",
  opponent: "Rivals FC",
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

  it("borders a pill that would disappear into the page, per theme", () => {
    expect(needsBorder("#ffffff", BACKGROUNDS.page.light)).toBe(true);
    expect(needsBorder("#111111", BACKGROUNDS.page.dark)).toBe(true);
    expect(needsBorder("#1e3a8a", BACKGROUNDS.page.light)).toBe(false);
    expect(needsBorder("#ffffff", BACKGROUNDS.page.dark)).toBe(false);
  });

  it("borders a calendar dot that would disappear into the green game chip, per theme", () => {
    // Pale green on the light chip, dark green on the dark one.
    expect(needsBorder("#dcfce7", BACKGROUNDS.gameChip.light)).toBe(true);
    expect(needsBorder("#0f2e1c", BACKGROUNDS.gameChip.dark)).toBe(true);
    expect(needsBorder("#dc2626", BACKGROUNDS.gameChip.light)).toBe(false);
    expect(needsBorder("#ffffff", BACKGROUNDS.gameChip.dark)).toBe(false);
  });

  it("the palette is the spec's twelve kit colors, all valid", () => {
    expect(UNIFORM_PALETTE.map((c) => c.name)).toEqual([
      "White", "Black", "Gray", "Navy", "Royal", "Sky", "Red", "Maroon", "Green", "Gold", "Orange", "Purple",
    ]);
    expect(UNIFORM_PALETTE.every((c) => isHexColor(c.hex))).toBe(true);
  });
});
