/**
 * The availability matrix's event window (BUG-014).
 *
 * The matrix used to load every event a team had ever held, and every response
 * to all of them — the query that reaches the API's 1,000-row cap first. The
 * window keeps the row count tied to what is on screen.
 */

import { describe, it, expect } from "vitest";
import { parseWindow, windowRange, windowDescription } from "@/lib/availability-window";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const days = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

describe("choosing a window", () => {
  it("defaults to upcoming, including for anything unrecognised", () => {
    expect(parseWindow(undefined)).toBe("upcoming");
    expect(parseWindow("")).toBe("upcoming");
    expect(parseWindow("everything")).toBe("upcoming");
    expect(parseWindow("../../etc")).toBe("upcoming");
  });

  it("accepts the windows the tabs offer", () => {
    expect(parseWindow("upcoming")).toBe("upcoming");
    expect(parseWindow("past")).toBe("past");
    expect(parseWindow("season")).toBe("season");
  });
});

describe("what each window covers", () => {
  it("upcoming starts now and looks forward half a year", () => {
    const range = windowRange("upcoming", NOW);

    expect(range.from).toBe(NOW.toISOString());
    expect(days(range.from, range.to)).toBe(180);
  });

  it("past covers the last 30 days, ending now", () => {
    const range = windowRange("past", NOW);

    expect(range.to).toBe(NOW.toISOString());
    expect(days(range.from, range.to)).toBe(30);
  });

  it("season is a bounded year either side, not everything", () => {
    const range = windowRange("season", NOW);

    expect(days(range.from, NOW.toISOString())).toBe(365);
    expect(days(NOW.toISOString(), range.to)).toBe(365);
  });

  it("every window is bounded at both ends", () => {
    for (const w of ["upcoming", "past", "season"] as const) {
      const range = windowRange(w, NOW);
      expect(new Date(range.from).getTime()).toBeLessThan(new Date(range.to).getTime());
      expect(Number.isFinite(new Date(range.from).getTime())).toBe(true);
      expect(Number.isFinite(new Date(range.to).getTime())).toBe(true);
    }
  });

  it("describes itself, so the page says what it is showing", () => {
    expect(windowDescription("upcoming")).toMatch(/upcoming/i);
    expect(windowDescription("past")).toMatch(/30 days/i);
    expect(windowDescription("season")).toMatch(/season/i);
  });
});
