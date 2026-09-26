"use client";

import { useCallback, useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NavigationProgressContext } from "@/components/layout/progress-bar";

/**
 * Navigate from code, with feedback while the next page is on its way.
 *
 * Dashboard pages render on the server after their queries, so a click can sit
 * for a moment before the next page arrives. A bare router.push gave no sign it
 * was heard: the top progress bar only watches anchor clicks. This runs the
 * push in a transition, so the caller knows it is pending until the next page
 * is on screen and can mark what was clicked, and it runs the progress bar
 * meanwhile. Every programmatic navigation goes through here.
 */
export function useNavigate() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const report = useContext(NavigationProgressContext);
  useEffect(() => {
    if (!isPending || !report) return;
    return report();
  }, [isPending, report]);

  const navigate = useCallback(
    (href: string) => {
      setTarget(href);
      startTransition(() => router.push(href));
    },
    [router]
  );

  return {
    navigate,
    isPending,
    /** Where the pending navigation is headed, to mark what was clicked. */
    pendingHref: isPending ? target : null,
  };
}
