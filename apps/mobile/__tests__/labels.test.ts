/**
 * Consistent labels for stored values (spec: docs/specs/mobile-next-build.md §1,
 * the web's docs/specs/team-branding-and-labels.md §1).
 *
 * Event types, roles, guardian relationships, home/away and game results are
 * stored lowercase ("game", "mom", "coach"). The app printed them raw, some
 * capitalized by a style, so "Mom" on one screen was "mom" on another and "step
 * parent" read "Step Parent" only where a style said so. displayLabel is the one
 * way they are shown, as on the web.
 */

import { displayLabel } from "../lib/labels";

// The app has no Node types (adding them changes its globals); the scan needs
// only these.
declare const __dirname: string;
const { readFileSync, readdirSync, statSync } = require("fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
};
const { join, relative } = require("path") as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

describe("displayLabel", () => {
  it("capitalizes each word", () => {
    expect(displayLabel("mom")).toBe("Mom");
    expect(displayLabel("game")).toBe("Game");
    expect(displayLabel("step parent")).toBe("Step Parent");
    expect(displayLabel("step-parent")).toBe("Step-Parent");
  });

  it("leaves an already capitalized value alone", () => {
    expect(displayLabel("Mom")).toBe("Mom");
    expect(displayLabel("SLOFC")).toBe("SLOFC");
  });

  it("capitalizes accented letters too", () => {
    expect(displayLabel("élan")).toBe("Élan");
  });

  it("shows a dash for nothing", () => {
    expect(displayLabel(null)).toBe("—");
    expect(displayLabel(undefined)).toBe("—");
    expect(displayLabel("")).toBe("—");
  });
});

// ── Source audit ──────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("no stored value is shown raw or capitalized by a style", () => {
  const files = ["app", "components"]
    .flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));

  it("finds the screens", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no file capitalizes with a style or a class", () => {
    const offenders = files
      .filter((f) => /textTransform:\s*["']capitalize["']|\bcapitalize\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no file prints a role, relationship, event type, result, home/away or gender straight onto the screen", () => {
    // `{member.role}`, `{m.relationship}`, `{event.event_type}` … as element text,
    // not as an attribute value (`={…}`) or a destructuring (`{ role } = …`).
    const raw = /(^|[^=\w])\{\s*[\w.?]*\b(role|relationship|event_type|game_result|home_away|gender)\s*\}(?!\s*=)/;
    // Database writes such as `.update({ role })` are not screen text.
    const writeCall = /\.(update|insert|upsert|eq|match)\(\{/;
    const offenders = files
      .flatMap((f) => f.text.split("\n").map((line, i) => ({ where: `${f.path}:${i + 1}`, line })))
      .filter(({ line }) => raw.test(line) && !writeCall.test(line))
      .map(({ where, line }) => `${where}  ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
