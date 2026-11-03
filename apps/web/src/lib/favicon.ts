import type { Metadata } from "next";
import { isClubPlan } from "@/lib/plan";
import type { BrandableTeam } from "@/lib/team-branding";

/**
 * Lista's icons. They live in public/, not app/: Next adds a favicon.ico in app/
 * to every page, whatever the metadata says, so a club's page would list Lista's
 * icon as well as its own (BUG-042).
 */
export const LISTA_ICONS: Metadata["icons"] = {
  icon: [
    { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
    { url: "/icon.png", sizes: "609x548", type: "image/png" },
  ],
};

export function clubIcons(url: string): Metadata["icons"] {
  return { icon: { url } };
}

/** A club team's favicon, else its club's logo; null outside a club, or for a club with neither. */
export function clubFaviconUrl(team: BrandableTeam): string | null {
  const org = team.organizations;
  return org && isClubPlan(org.plan) ? org.favicon_url || org.logo_url || null : null;
}
