import { describe, it, expect } from "vitest";
import {
  TRAINING_CATEGORIES,
  isCurrentPeriodOrLater,
  monthStartStr,
  periodLabel,
  stepAnchor,
  weekStartStr,
} from "@/lib/training";

describe("training period helpers", () => {
  it("weekStartStr returns the Monday of the anchor's week", () => {
    // 2026-07-13 is a Monday
    expect(weekStartStr("2026-07-13")).toBe("2026-07-13");
    // Sunday 2026-07-12 belongs to the week starting Mon 2026-07-06
    expect(weekStartStr("2026-07-12")).toBe("2026-07-06");
    // Wednesday 2026-07-15 → Monday 2026-07-13
    expect(weekStartStr("2026-07-15")).toBe("2026-07-13");
  });

  it("monthStartStr returns the first of the month", () => {
    expect(monthStartStr("2026-07-13")).toBe("2026-07-01");
    expect(monthStartStr("2026-12-31")).toBe("2026-12-01");
  });

  it("stepAnchor moves by a week and clears month/year boundaries", () => {
    expect(stepAnchor("week", "2026-07-13", -1)).toBe("2026-07-06");
    expect(stepAnchor("week", "2026-07-13", 1)).toBe("2026-07-20");
    // week step across a month boundary
    expect(stepAnchor("week", "2026-07-01", -1)).toBe("2026-06-24");
  });

  it("stepAnchor moves by a month and clears year boundaries", () => {
    expect(stepAnchor("month", "2026-01-15", -1)).toBe("2025-12-15");
    expect(stepAnchor("month", "2026-12-15", 1)).toBe("2027-01-15");
  });

  it("periodLabel formats week ranges and months", () => {
    expect(periodLabel("week", "2026-07-13")).toBe("Jul 13 – Jul 19");
    expect(periodLabel("week", "2026-07-12")).toBe("Jul 6 – Jul 12");
    expect(periodLabel("month", "2026-07-13")).toBe("July 2026");
    expect(periodLabel("month", "2026-01-01")).toBe("January 2026");
  });

  it("isCurrentPeriodOrLater is true for the current/future period, false for the past", () => {
    const today = "2026-07-15"; // a Wednesday
    expect(isCurrentPeriodOrLater("week", today, today)).toBe(true);
    expect(isCurrentPeriodOrLater("week", "2026-07-08", today)).toBe(false); // last week
    expect(isCurrentPeriodOrLater("week", "2026-07-22", today)).toBe(true); // next week
    expect(isCurrentPeriodOrLater("month", "2026-07-01", today)).toBe(true);
    expect(isCurrentPeriodOrLater("month", "2026-06-30", today)).toBe(false); // last month
  });

  it("category list has the expected nine values", () => {
    expect(TRAINING_CATEGORIES).toHaveLength(9);
    expect(TRAINING_CATEGORIES).toContain("ball_mastery");
    expect(TRAINING_CATEGORIES).toContain("other");
  });
});
