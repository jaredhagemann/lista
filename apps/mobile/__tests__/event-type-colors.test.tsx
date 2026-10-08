/**
 * One color per event type, as on the web (2026-10-08): practice blue, game
 * green, tournament purple, other yellow. Keep in step with
 * apps/web/src/lib/events/type-colors.ts.
 *
 * Tournaments were amber on the phone, the same background as a Maybe answer,
 * and "other" was purple. Each screen kept its own map. Now they share one, and
 * nothing else defines a type's color.
 */

import { EVENT_TYPE_COLORS, eventTypeColors, PART_OF_COLOR } from "../lib/event-type-colors";

// Node's file system, for the scan below: Jest runs in Node, but the app's
// types don't include Node's.
declare const require: (id: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
const fs = require("fs");
const path = require("path");

const PURPLE = { bg: "#f3e8ff", text: "#7e22ce" };
const YELLOW = { bg: "#fef9c3", text: "#854d0e" };

describe("the colors", () => {
  it("tournament is purple, other is yellow, practice blue and game green", () => {
    expect(EVENT_TYPE_COLORS.tournament).toEqual(PURPLE);
    expect(EVENT_TYPE_COLORS.other).toEqual(YELLOW);
    expect(EVENT_TYPE_COLORS.practice).toEqual({ bg: "#dbeafe", text: "#1d4ed8" });
    expect(EVENT_TYPE_COLORS.game).toEqual({ bg: "#dcfce7", text: "#15803d" });
  });

  it("no type uses Maybe's amber", () => {
    for (const { bg } of Object.values(EVENT_TYPE_COLORS)) expect(bg).not.toBe("#fef3c7");
  });

  it("an unknown type is shown as other", () => {
    expect(eventTypeColors("scrimmage")).toBe(EVENT_TYPE_COLORS.other);
  });

  it("a game's tournament line is in the tournament's purple", () => {
    expect(PART_OF_COLOR).toBe(PURPLE.text);
  });
});

describe("one place for them", () => {
  // A type's purple or yellow anywhere else is a type color defined twice.
  it("no screen or component repeats them", () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8").toLowerCase();
          if ([PURPLE.bg, PURPLE.text, YELLOW.bg, YELLOW.text, "#92400e"].some((c) => text.includes(c))) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    for (const dir of ["app", "components"]) walk(path.join(root, dir));
    expect(offenders).toEqual([]);
  });
});
