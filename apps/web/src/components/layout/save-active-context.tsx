"use client";

import { useEffect } from "react";
import { saveActiveContext } from "@/app/actions/context";

/**
 * Saves the context this page was rendered with, on a device that had none or
 * whose saved team was no longer valid (spec D2, D3). Once saved, the device
 * keeps it, whatever other devices pick.
 */
export function SaveActiveContext({ profileId, teamId }: { profileId: string; teamId: string }) {
  useEffect(() => {
    saveActiveContext(profileId, teamId).catch(() => {
      // Not saved: the next page load chooses again and asks again.
    });
  }, [profileId, teamId]);

  return null;
}
