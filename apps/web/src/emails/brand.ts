import { clubSecondaryColor, LISTA_BLUE, type OrgBranding } from "@/lib/team-branding";
import { isClubPlan } from "@/lib/plan";
import type { TenantContext } from "@/lib/supabase/tenant";

/**
 * Who an email comes from, and how it looks (spec: docs/specs/email-upgrade.md §4.2).
 *
 * An email about a club team carries the club: its logo (the team's own
 * first, as in the app), its public name (else its internal name) and its
 * secondary color (D2), and it's sent in the club's name. Everything else
 * carries lista.
 */
export type EmailBrand = {
  /** Named in the copy: "on SLOFC", "on Lista". */
  name: string;
  /** The header image; without one, the header shows the name as text. */
  logoUrl: string | null;
  /** Buttons and accents: a hex color. */
  color: string;
  /** The sender's display name; null sends as lista. */
  fromName: string | null;
};

// No lista logo image yet (D4): the header shows the "lista" wordmark.
export const LISTA_BRAND: EmailBrand = { name: "Lista", logoUrl: null, color: LISTA_BLUE, fromName: null };

export function clubEmailBrand(org: OrgBranding | null | undefined, teamLogoUrl?: string | null): EmailBrand {
  if (!org || !isClubPlan(org.plan)) return LISTA_BRAND;
  const name = org.org_name_public?.trim() || org.name?.trim() || LISTA_BRAND.name;
  return {
    name,
    logoUrl: teamLogoUrl || org.logo_url || null,
    color: clubSecondaryColor(org) ?? LISTA_BLUE,
    fromName: name,
  };
}

/** The brand of the site a request came in on: a club's own site, or lista. */
export function tenantEmailBrand(tenant: TenantContext | null | undefined): EmailBrand {
  if (!tenant?.isWhiteLabel) return LISTA_BRAND;
  return clubEmailBrand({
    org_name_public: tenant.orgNamePublic,
    logo_url: tenant.logoUrl,
    plan: tenant.plan,
    brand_color_secondary: tenant.brandColorSecondary,
  });
}

const DARK_TEXT = "#111827";
const LIGHT_TEXT = "#ffffff";

function luminance(hex: string): number {
  let digits = hex.replace("#", "");
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Text on a button of this color: whichever of dark or white reads better (WCAG contrast). */
export function buttonTextColor(background: string): string {
  const bg = luminance(background);
  return contrast(bg, luminance(DARK_TEXT)) >= contrast(bg, luminance(LIGHT_TEXT)) ? DARK_TEXT : LIGHT_TEXT;
}

/** The team columns a sender selects to brand a team's email. */
export const TEAM_BRAND_COLUMNS =
  "logo_url, organizations(name, org_name_public, logo_url, plan, brand_color_secondary)";

export type BrandedTeam = { logo_url?: string | null; organizations?: OrgBranding | null };

/** A team's email brand, from a row selected with TEAM_BRAND_COLUMNS. */
export function teamEmailBrand(team: BrandedTeam | null | undefined): EmailBrand {
  return clubEmailBrand(team?.organizations, team?.logo_url);
}
