/**
 * Which favicon a page asks for (BUG-042).
 *
 * The metadata always looked right for a club. The bug was around it: Next adds
 * app/favicon.ico to every page, whatever the metadata says, so a club's page
 * listed Lista's icon first and the club's second, and the browser could pick
 * Lista's. Lista's icons now live in public/ and only the metadata names them.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

import { generateMetadata } from "@/app/layout";

const CLUB_FAVICON = "https://x.supabase.co/storage/v1/object/public/org-images/o1/favicon?t=1";
const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-images/o1/logo?t=1";

function onClub(headers: Record<string, string>) {
  mocks.headers = new Headers({ "x-tenant-id": "o1", "x-tenant-is-white-label": "true", ...headers });
}

const icons = async () => (await generateMetadata()).icons as { icon: unknown };

describe("the root layout's favicon", () => {
  beforeEach(() => {
    mocks.headers = new Headers();
  });

  it("on a club's domain, is the club's and only the club's", async () => {
    onClub({ "x-tenant-favicon-url": CLUB_FAVICON, "x-tenant-logo-url": CLUB_LOGO });

    expect((await icons()).icon).toEqual({ url: CLUB_FAVICON });
  });

  it("on a club's domain with a logo but no favicon, is the logo", async () => {
    onClub({ "x-tenant-logo-url": CLUB_LOGO });

    expect((await icons()).icon).toEqual({ url: CLUB_LOGO });
  });

  it("on a club's domain with neither, is Lista's", async () => {
    onClub({});

    expect(JSON.stringify((await icons()).icon)).toContain("/favicon.ico");
  });

  it("on Lista's own domain, is Lista's", async () => {
    expect(JSON.stringify((await icons()).icon)).toContain("/favicon.ico");
    expect(JSON.stringify((await icons()).icon)).toContain("/icon.png");
  });

  it("is Lista's when the org isn't white-labelled, even with a favicon set", async () => {
    mocks.headers = new Headers({ "x-tenant-id": "o1", "x-tenant-is-white-label": "false", "x-tenant-favicon-url": CLUB_FAVICON });

    expect(JSON.stringify((await icons()).icon)).not.toContain(CLUB_FAVICON);
  });
});

describe("Lista's icon files", () => {
  // In app/, Next would add them to every page alongside a club's.
  it.each(["favicon.ico", "icon.png", "icon.ico", "icon.svg"])("%s isn't a file-based icon in app/", (file) => {
    expect(existsSync(resolve(process.cwd(), "src/app", file))).toBe(false);
  });

  it.each(["favicon.ico", "icon.png"])("%s is served from public/, where the metadata points", (file) => {
    expect(existsSync(resolve(process.cwd(), "public", file))).toBe(true);
  });
});
