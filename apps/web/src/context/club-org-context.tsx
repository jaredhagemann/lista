"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type ClubOrg = {
  orgId: string;
  orgName: string;
  orgRole: "owner" | "director";
  plan: string;
  subscriptionStatus: string | null;
};

export const ClubOrgContext = createContext<ClubOrg | null>(null);

export function ClubOrgProvider({ children, value }: { children: ReactNode; value: ClubOrg }) {
  return <ClubOrgContext.Provider value={value}>{children}</ClubOrgContext.Provider>;
}

export function useClubOrg(): ClubOrg {
  const ctx = useContext(ClubOrgContext);
  if (!ctx) throw new Error("useClubOrg must be used within a ClubOrgContext provider");
  return ctx;
}
