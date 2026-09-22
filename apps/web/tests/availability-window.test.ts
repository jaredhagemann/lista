/**
 * The availability matrix's date windows (BUG-014, spec §5 and §7).
 *
 * The matrix used to load every event a team had ever held. It now covers a
 * window, measured from an anchor that is frozen for the session: recomputing
 * "now" between pages would move the window underneath the reader, so page two
 * could omit an event page one had shown, or repeat one.
 *
 * These are rolling 24-hour windows, unlike calendar months.
 */

import { describe, it, expect } from "vitest";
import {
  AVAILABILITY_WINDOWS,
  parseWindow,
  windowRange,
  windowLabel,
  bulkRange,
  bulkScopeSentence,
  type AvailabilityWindow,
} from "@/lib/availability/window";

const ANCHOR = "2026-09-21T12:00:00.000Z";
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

describe("choosing a window", () => {
  it("defaults to upcoming for anything unrecognised", () => {
    expect(parseWindow(undefined)).toBe("upcoming");
    expect(parseWindow("")).toBe("upcoming");
    expect(parseWindow("everything")).toBe("upcoming");
  });

  it("offers exactly the three windows the spec names", () => {
    expect(AVAILABILITY_WINDOWS.map((w) => w.value)).toEqual(["upcoming", "past", "season"]);
  });
});

describe("what each window covers", () => {
  it("looks forward 180 days from the anchor", () => {
    const range = windowRange("upcoming", ANCHOR);

    expect(range.fromInclusive).toBe(ANCHOR);
    expect(days(range.fromInclusive, range.toExclusive)).toBe(180);
  });

  it("looks back 30 days, ending at the anchor", () => {
    const range = windowRange("past", ANCHOR);

    expect(range.toExclusive).toBe(ANCHOR);
    expect(days(range.fromInclusive, range.toExclusive)).toBe(30);
  });

  it("covers a year either side, not all of history", () => {
    const range = windowRange("season", ANCHOR);

    expect(days(range.fromInclusive, ANCHOR)).toBe(365);
    expect(days(ANCHOR, range.toExclusive)).toBe(365);
  });

  it("gives the same range every time for one anchor", () => {
    // The point of freezing it: page two asks the same question page one did.
    const first = windowRange("upcoming", ANCHOR);
    const second = windowRange("upcoming", ANCHOR);

    expect(second).toEqual(first);
  });

  it("moves with a new anchor", () => {
    const later = windowRange("upcoming", "2026-09-22T12:00:00.000Z");

    expect(later.fromInclusive).not.toBe(windowRange("upcoming", ANCHOR).fromInclusive);
  });
});

describe("saying what is on screen", () => {
  it("names the actual dates rather than claiming a season", () => {
    const label = windowLabel("season", ANCHOR, "America/Los_Angeles");

    // "Whole season" would be a claim the data cannot support: this is a rolling
    // year either side of now, not a season record.
    // A year either side of the anchor: September 2025 through September 2027.
    expect(label).toMatch(/Sep 2[01], 2025/);
    expect(label).toMatch(/Sep 2[01], 2027/);
    expect(label.toLowerCase()).not.toContain("season");
  });

  it("describes the other two windows in the reader's terms", () => {
    expect(windowLabel("upcoming", ANCHOR, "UTC").toLowerCase()).toContain("upcoming");
    expect(windowLabel("past", ANCHOR, "UTC").toLowerCase()).toContain("30 days");
  });

  it("labels every window without throwing", () => {
    for (const window of AVAILABILITY_WINDOWS) {
      expect(windowLabel(window.value as AvailabilityWindow, ANCHOR, "UTC").length).toBeGreaterThan(0);
    }
  });
});

describe("what a bulk action can reach", () => {
  const anchor = "2026-09-21T18:00:00.000Z";

  it("covers the future half of a window, and none of a past-only one", () => {
    expect(bulkRange("past", anchor)).toBeNull();

    const upcoming = bulkRange("upcoming", anchor)!;
    expect(upcoming.fromInclusive).toBe(anchor);
    expect(upcoming.toExclusive).toBe(windowRange("upcoming", anchor).toExclusive);

    // The wider range reaches a year back, but a past event cannot be answered,
    // so the bulk scope starts at the anchor rather than at the window's edge.
    const wider = bulkRange("season", anchor)!;
    expect(wider.fromInclusive).toBe(anchor);
    expect(wider.toExclusive).toBe(windowRange("season", anchor).toExclusive);
  });

  it("names the player, status, dates, type and the pages nobody has seen", () => {
    const sentence = bulkScopeSentence({
      name: "Alex",
      status: "available",
      window: "upcoming",
      anchor,
      eventType: "practice",
      timeZone: "America/Los_Angeles",
    })!;

    expect(sentence).toContain("Set Alex to Available");
    expect(sentence).toContain("unanswered future practices");
    expect(sentence).toContain("Sep 21, 2026");
    expect(sentence).toContain("Mar 20, 2027");
    expect(sentence).toContain("including events on other pages");
    expect(sentence).toContain("Existing responses will not be changed");
  });

  it("says events, not a type, when no type is selected", () => {
    const sentence = bulkScopeSentence({
      name: "Alex",
      status: "maybe",
      window: "season",
      anchor,
      eventType: null,
      timeZone: "UTC",
    })!;

    expect(sentence).toContain("Set Alex to Maybe for unanswered future events");
  });

  it("has nothing to offer for a past-only window", () => {
    expect(
      bulkScopeSentence({
        name: "Alex",
        status: "available",
        window: "past",
        anchor,
        eventType: null,
        timeZone: "UTC",
      })
    ).toBeNull();
  });
});
