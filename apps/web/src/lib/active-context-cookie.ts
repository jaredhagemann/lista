/**
 * The device's saved context (docs/specs/device-local-active-context.md, D1):
 * the account, the profile it views as, and the team, kept together in one
 * HTTP-only cookie, so a switch on one device never moves another.
 *
 * The value is `v1.<account>.<profile>.<team>`, ids only. It is never trusted:
 * every read checks it against the account's own and managed profiles and their
 * memberships (lib/active-context.ts, D6).
 */

export const ACTIVE_CONTEXT_COOKIE = "lista_context";

/** The cookie the profile alone used to live in. Read once, to seed a context, then ignored. */
export const LEGACY_PROFILE_COOKIE = "active_profile_id";

const BASE_DOMAIN = "lista.team";
const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SavedContext = { accountId: string; profileId: string; teamId: string };

export function encodeContext({ accountId, profileId, teamId }: SavedContext): string {
  return [VERSION, accountId, profileId, teamId].join(".");
}

/** The saved context, or null for a missing, malformed or other-version value. */
export function decodeContext(value: string | null | undefined): SavedContext | null {
  const parts = (value ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, accountId, profileId, teamId] = parts;
  if (![accountId, profileId, teamId].every((id) => UUID.test(id))) return null;
  return { accountId, profileId, teamId };
}

/**
 * Options for the device's context cookies. In production with subdomain
 * routing, scoped to .lista.team so club subdomains and the main site share it;
 * otherwise the current host.
 */
export function contextCookieOptions(overrides: { maxAge?: number } = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    domain:
      process.env.SUBDOMAIN_ROUTING_ENABLED !== "false" && process.env.NODE_ENV === "production"
        ? `.${BASE_DOMAIN}`
        : undefined,
    maxAge: 60 * 60 * 24 * 365,
    ...overrides,
  };
}
