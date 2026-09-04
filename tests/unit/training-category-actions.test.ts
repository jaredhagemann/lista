import { describe, it, expect } from "vitest";
import {
  validateCategoryLabel,
  planSuggestedCategories,
  SPORT_CATEGORY_SUGGESTIONS,
} from "@/lib/training";

describe("validateCategoryLabel", () => {
  it("trims and accepts a normal label", () => {
    expect(validateCategoryLabel("  Dribbling  ")).toEqual({ label: "Dribbling" });
  });

  it("rejects empty / whitespace-only and over-length labels", () => {
    expect("error" in validateCategoryLabel("")).toBe(true);
    expect("error" in validateCategoryLabel("   ")).toBe(true);
    expect("error" in validateCategoryLabel("\t\n")).toBe(true);
    expect("error" in validateCategoryLabel("x".repeat(41))).toBe(true);
    expect(validateCategoryLabel("x".repeat(40))).toEqual({ label: "x".repeat(40) });
  });
});

describe("planSuggestedCategories (prefetch-filter)", () => {
  const soccer = SPORT_CATEGORY_SUGGESTIONS.soccer!;

  it("inserts only missing labels; skips active; reports archived; appends in order", () => {
    const existing = [
      { label: "Passing", is_active: true, sort_order: 10 },
      { label: "Shooting", is_active: false, sort_order: 20 }, // archived
    ];
    const plan = planSuggestedCategories(existing, soccer);

    expect(plan.alreadyActive).toBe(1); // "Passing"
    expect(plan.archived).toEqual(["Shooting"]); // reported, not resurrected
    expect(plan.toInsert.map((r) => r.label)).not.toContain("Passing");
    expect(plan.toInsert.map((r) => r.label)).not.toContain("Shooting");
    expect(plan.toInsert).toHaveLength(soccer.length - 2);
    // appends after max(existing sort_order)=20, in increments of 10
    expect(plan.toInsert[0].sort_order).toBe(30);
    expect(plan.toInsert[1].sort_order).toBe(40);
  });

  it("matches case- and whitespace-insensitively", () => {
    const existing = [{ label: "  ball MASTERY ", is_active: true, sort_order: 10 }];
    const plan = planSuggestedCategories(existing, ["Ball mastery", "Passing"]);
    expect(plan.alreadyActive).toBe(1);
    expect(plan.toInsert.map((r) => r.label)).toEqual(["Passing"]);
  });

  it("is idempotent: everything present → nothing to insert", () => {
    const existing = soccer.map((label, i) => ({ label, is_active: true, sort_order: (i + 1) * 10 }));
    const plan = planSuggestedCategories(existing, soccer);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.alreadyActive).toBe(soccer.length);
    expect(plan.archived).toHaveLength(0);
  });

  it("starts at 10 when the team has no categories", () => {
    const plan = planSuggestedCategories([], ["First", "Second"]);
    expect(plan.toInsert.map((r) => r.sort_order)).toEqual([10, 20]);
  });
});
