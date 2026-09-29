/**
 * Server code never imports values from a "use client" module (PR #96 review, P1).
 *
 * On the server, Next turns every export of a "use client" file into a client
 * reference: a component can still be rendered, but a constant reads as empty
 * and a function throws when called. The email-answer handler imported the
 * availability labels and save function from the picker, so on the server
 * Object.keys(AVAILABILITY) was [] and every answer was rejected. Vitest doesn't
 * apply that transform, so no behavioral test could see it; this reads the
 * imports instead.
 *
 * Server code here: modules under src/lib and src/emails, and route handlers,
 * pages and layouts under src/app, when they aren't "use client" themselves.
 * A type-only import is fine (erased), and so is rendering a component, which
 * is what a client reference is for: PascalCase names are allowed.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

const isClient = (source: string) => /^\s*(["'])use client\1/.test(source);

function resolve(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(SRC, specifier.slice(2));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The value names an import statement brings in: not `import type`, not `type X`. */
function valueNames(clause: string): string[] {
  if (/^\s*type\s/.test(clause)) return [];
  const braces = clause.match(/\{([^}]*)\}/);
  const named = braces
    ? braces[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("type "))
        .map((s) => s.split(/\s+as\s+/).pop()!.trim())
    : [];
  const defaultName = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
  return defaultName ? [defaultName, ...named] : named;
}

function isServerFile(path: string, source: string): boolean {
  if (isClient(source)) return false;
  const rel = relative(SRC, path).replace(/\\/g, "/");
  return (
    rel.startsWith("lib/") ||
    rel.startsWith("emails/") ||
    /^app\/.*\/(route|page|layout)\.tsx?$/.test(rel) ||
    /^app\/(page|layout)\.tsx?$/.test(rel)
  );
}

describe("the server/client boundary", () => {
  it("no server module imports a non-component value from a 'use client' module", () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const source = readFileSync(path, "utf8");
      if (!isServerFile(path, source)) continue;
      for (const match of source.matchAll(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
        const target = resolve(match[2]);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        const values = valueNames(match[1]).filter((name) => !/^[A-Z][a-z]/.test(name));
        if (values.length > 0) offenders.push(`${relative(SRC, path)} imports ${values.join(", ")} from ${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
