"use client";

import { useEffect } from "react";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a dashboard tab acting as the account it shows (BUG-036).
 *
 * The page is rendered on the server for `userId`, but its writes go from the
 * browser with whatever session the browser holds. If that turns out to be
 * another account's (one signed in in another tab, say), the tab does a full
 * reload of the dashboard, so nothing from the old account survives; if the
 * session has ended, it goes to the login page. A token refresh for the same
 * account changes nothing (decided 2026-10-16).
 *
 * Another tab's sign-in reaches this one only when it next reads the session,
 * so the session is also checked whenever the tab is shown again.
 */
export function SessionWatch({ userId }: { userId: string }) {
  useEffect(() => {
    const supabase = createClient();
    let leaving = false;
    const leave = (path: string) => {
      if (leaving) return;
      leaving = true;
      window.location.assign(path);
    };
    const follow = (sessionUserId: string | null) => {
      if (sessionUserId === null) leave("/login");
      else if (sessionUserId !== userId) leave("/dashboard");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") follow(null);
      else if (session?.user) follow(session.user.id);
    });

    function check() {
      if (document.visibilityState === "hidden") return;
      supabase.auth.getUser().then(({ data, error }) => {
        if (data.user) follow(data.user.id);
        // Only a missing session means signed out; a failed request proves nothing.
        else if (isAuthSessionMissingError(error)) follow(null);
      });
    }
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [userId]);

  return null;
}
