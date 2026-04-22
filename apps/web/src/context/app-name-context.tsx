"use client";

import { createContext, useContext } from "react";

/**
 * Carries the app display name through the React tree.
 * On default lista.team: "Lista"
 * On a white-label club subdomain: the org's public name (e.g. "Joga FC")
 *
 * Set by the root RSC layout via <AppNameContext value={appName}>.
 * Consumed by client components via useAppName().
 */
export const AppNameContext = createContext<string>("Lista");

export function useAppName(): string {
  return useContext(AppNameContext);
}
