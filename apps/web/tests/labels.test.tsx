// @vitest-environment jsdom
/**
 * Consistent labels for stored values (spec: docs/specs/team-branding-and-labels.md §1).
 *
 * Event types, roles, guardian relationships, home/away and game results are
 * stored lowercase ("game", "mom", "coach"). Some places printed them as-is and
 * some capitalized them with CSS, so the same value read "mom" in one place and
 * "Mom" in another. displayLabel is now the one way they are shown.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { displayLabel } from "@/lib/labels";

describe("displayLabel", () => {
  it("capitalizes each word", () => {
    expect(displayLabel("mom")).toBe("Mom");
    expect(displayLabel("game")).toBe("Game");
    expect(displayLabel("step parent")).toBe("Step Parent");
  });

  it("leaves an already capitalized value alone", () => {
    expect(displayLabel("Mom")).toBe("Mom");
    expect(displayLabel("SLOFC")).toBe("SLOFC");
  });

  it("shows a dash for nothing", () => {
    expect(displayLabel(null)).toBe("—");
    expect(displayLabel(undefined)).toBe("—");
    expect(displayLabel("")).toBe("—");
  });
});

// ── Source audit ──────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("no stored value is shown raw or capitalized by CSS", () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

  it("no file uses the capitalize class", () => {
    const offenders = files.filter((f) => /\bcapitalize\b/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no file prints a role, relationship, event type, result, home/away or gender straight into the page", () => {
    // `{member.role}`, `{m.relationship}`, `{event.event_type}` … as element text,
    // not as an attribute value (`={…}`) or a destructuring (`{ role } = …`).
    const raw = /(^|[^=\w])\{\s*[\w.?]*\b(role|relationship|event_type|game_result|home_away|gender)\s*\}(?!\s*=)/;
    // Database writes such as `.update({ role })` are not page text.
    const writeCall = /\.(update|insert|upsert|eq|match)\(\{/;
    const offenders = files
      .flatMap((f) =>
        f.text.split("\n").map((line, i) => ({ where: `${f.path}:${i + 1}`, line }))
      )
      .filter(({ line }) => raw.test(line) && !writeCall.test(line))
      .map(({ where, line }) => `${where}  ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
