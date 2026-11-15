"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rebuilds the layout after a link switched the active team. Following a link
 * within the app keeps the layout it was on, so the header would go on naming the
 * old team. Drops the switched mark first, so this happens once.
 */
export function RefreshAfterTeamSwitch() {
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("switched");
    window.history.replaceState(null, "", url);
    router.refresh();
  }, [router]);

  return null;
}
