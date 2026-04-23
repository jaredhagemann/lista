"use client";

import { createContext, useContext } from "react";

export type ClubOrg = {
  orgId: string;
  orgName: string;
  orgRole: "owner" | "director";
  plan: string;
  subscriptionStatus: string | null;
};

export const ClubOrgContext = createContext<ClubOrg | null>(null);

export function useClubOrg(): ClubOrg {
  const ctx = useContext(ClubOrgContext);
  if (!ctx) throw new Error("useClubOrg must be used within a ClubOrgContext provider");
  return ctx;
}
